-- ============================================================================
-- 0038  LEAVE SALARY — the annual payout model that replaces PL/CL/SL.
-- ----------------------------------------------------------------------------
-- The company scrapped the three-way leave distribution. The new policy, from
-- the owner's "Leave salary working" sheet:
--
--   * Every employee gets ONE pool of paid leave: 15 days per calendar year.
--   * Separately, an annual LEAVE SALARY is paid out, computed per employee:
--       - annual base            = monthly gross / 2   (15 days = half a month)
--       - the year splits at the appraisal (increment effective 1 April), so
--         Jan–Mar runs on the pre-increment salary and Apr–Dec on the new one
--       - per period: entitled = (salary/2) × months/12
--                     payable  = entitled × present_days / calendar_days
--       - present days credit: HD = 0.5, AB and L = 0, everything else = 1
--         (week-offs and holidays COUNT — the sheet's own numbers require it)
--
-- Worked sample from the sheet (year 2025, increment April):
--   25000→30000, present 86/90 and 258.5/275 ⇒ 2986.11 + 10575 = 13561.11
--
-- What this migration deliberately does NOT do:
--   * No table is dropped. leave_balances / leave_balance_adjustments stay (the
--     PL pool and its audit live on); leave_encashment stays because exit
--     full-and-final sums it. CL/SL rows already written remain as history.
--   * The leave_type enum keeps CL/SL values — retiring enum values in Postgres
--     is not worth the pain; the app simply stops offering them.
-- ============================================================================


-- ============================================================================
-- §1  leave_salary_workings — one row per employee per year.
-- ----------------------------------------------------------------------------
-- Salaries are ENTERED BY HR (the schema keeps no salary history; editing an
-- employee overwrites gross_monthly in place, so the pre-appraisal figure only
-- exists in someone's records). The computed figures are SNAPSHOTTED at save so
-- later attendance edits cannot silently rewrite an amount that was already
-- finalized or paid — the app recomputes and re-stamps on save/finalize only.
-- ============================================================================
create table if not exists leave_salary_workings (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references employees(id) on delete cascade,
  year                integer not null check (year between 2000 and 2100),

  -- HR-entered monthly GROSS figures (owner confirmed gross, not basic+DA).
  salary_before       numeric(12,2) not null check (salary_before >= 0),
  salary_after        numeric(12,2) not null check (salary_after  >= 0),

  -- First day the post-appraisal salary applies. Constrained to the 1st of a
  -- month so the split stays whole-month, exactly like the owner's sheet
  -- (months/12, never fractional months). The app defaults it to 1 April.
  increment_effective date not null check (extract(day from increment_effective) = 1),

  -- Snapshot of the computation at the last save/finalize. p1 = before the
  -- increment, p2 = from the increment on. Presence is credit-weighted days
  -- (numeric(6,1): half-days make .5 steps), denominators are calendar days.
  present_p1          numeric(6,1)  not null default 0 check (present_p1 >= 0),
  present_p2          numeric(6,1)  not null default 0 check (present_p2 >= 0),
  calendar_days_p1    integer       not null default 0 check (calendar_days_p1 >= 0),
  calendar_days_p2    integer       not null default 0 check (calendar_days_p2 >= 0),
  amount_p1           numeric(12,2) not null default 0 check (amount_p1 >= 0),
  amount_p2           numeric(12,2) not null default 0 check (amount_p2 >= 0),
  total_amount        numeric(12,2) not null default 0 check (total_amount >= 0),

  -- draft → finalized → paid. Reopen (finalized → draft) exists in the app;
  -- paid is terminal there.
  status              text not null default 'draft'
                        check (status in ('draft', 'finalized', 'paid')),
  remarks             text,
  paid_at             timestamptz,
  paid_by             uuid references profiles(id) on delete set null,
  updated_by          uuid references profiles(id) on delete set null,
  updated_at          timestamptz not null default now(),

  unique (employee_id, year)
);

create index if not exists leave_salary_workings_year_idx
  on leave_salary_workings (year);

comment on table leave_salary_workings is
  'Annual leave-salary working per employee: HR-entered before/after-appraisal gross, '
  'attendance-derived presence, and the payable amounts, snapshotted at save. '
  'Formula per period: (salary/2) x months/12 x present_days/calendar_days.';
comment on column leave_salary_workings.increment_effective is
  'First day of the post-appraisal salary (always the 1st of a month; app default 1 April). '
  'Splits the year into the before/after periods of the working.';
comment on column leave_salary_workings.total_amount is
  'amount_p1 + amount_p2 at the last snapshot. Authoritative once status leaves draft.';

drop trigger if exists leave_salary_workings_touch on leave_salary_workings;
create trigger leave_salary_workings_touch
  before update on leave_salary_workings
  for each row execute function set_updated_at();

alter table leave_salary_workings enable row level security;

-- Staff manage the working; an employee may read their own row (their payout is
-- their business), never write it.
drop policy if exists leave_salary_workings_staff_all on leave_salary_workings;
create policy leave_salary_workings_staff_all on leave_salary_workings
  for all using (is_staff()) with check (is_staff());

drop policy if exists leave_salary_workings_read_own on leave_salary_workings;
create policy leave_salary_workings_read_own on leave_salary_workings
  for select using (employee_id = current_employee_id());


-- ============================================================================
-- §2  SETTINGS — one pool of 15, nothing carries forward.
-- ----------------------------------------------------------------------------
-- UPDATEs, not seeds: 0036 seeded these `on conflict do nothing`, so the old
-- values are in place and must actually change. Carry-forward drops to 0
-- because the leave-salary payout already compensates the year's leave value —
-- carrying unused days forward as well would pay for them twice.
-- ============================================================================
update settings set
  value       = '15'::jsonb,
  label       = 'Annual paid-leave entitlement',
  description = 'Paid-leave days credited to each employee still on the roster (active or serving '
                'notice) when a leave year is provisioned. One pool — the CL/SL split is retired.'
where key = 'leave_annual_pl';

update settings set
  value       = '0'::jsonb,
  description = 'Maximum unused days carried from one leave year into the next. 0 under the '
                'leave-salary policy: the annual payout already compensates the year''s leave '
                'value, so carrying days forward would double-count them.'
where key = 'leave_carry_forward_cap';

-- Retired knobs. Nothing in the app reads them (the Settings screen renders
-- whatever rows exist, and fn_provision below no longer looks at them).
delete from settings where key in ('leave_annual_cl', 'leave_annual_sl');


-- ============================================================================
-- §3  fn_provision_leave_balances — PL only.
-- ----------------------------------------------------------------------------
-- Same name, signature and auth gate as 0036 §4, so the 'leave-annual-provision'
-- cron keeps calling it unchanged. The entitlement CTE shrinks to the single
-- PL row (default now 15). The carry-forward code path is kept intact rather
-- than deleted — the cap setting governs it, and 0 makes it contribute nothing.
-- ============================================================================
create or replace function fn_provision_leave_balances(p_year int)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Floored at 0 so a negative cap cannot turn carry-forward into a debit.
  v_cap     numeric := greatest(fn_setting_numeric('leave_carry_forward_cap', 0), 0);
  v_created integer := 0;
begin
  -- Authorisation (see 0036's file header). Unguarded, any signed-in employee
  -- could bulk-insert leave_balances rows from a browser console.
  if auth.uid() is not null and not coalesce(is_staff(), false) then
    raise exception 'Not permitted: only staff (or the scheduler) may provision a leave year.'
      using errcode = '42501';
  end if;

  if p_year is null or p_year < 2000 or p_year > 2200 then
    raise exception 'fn_provision_leave_balances: implausible year %', p_year;
  end if;

  with entitlement (type, annual) as (
    -- ONE pool now. CL/SL are retired (their settings rows are gone); LWP is
    -- loss-of-pay — a request kind, never an entitlement.
    values ('PL'::leave_type, fn_setting_numeric('leave_annual_pl', 15))
  ),
  provisioned as (
    insert into leave_balances (employee_id, year, type, balance)
    select e.id,
           p_year,
           t.type,
           round(
             t.annual
             + least(greatest(coalesce(prev.balance, 0), 0), v_cap),
             1
           )
      from employees e
      cross join entitlement t
      left join leave_balances prev
        on prev.employee_id = e.id
       and prev.year        = p_year - 1
       and prev.type        = t.type
     -- 'on_notice' still works and still takes leave; 'inactive' is excluded.
     where e.status in ('active', 'on_notice')
       and e.date_of_joining <= make_date(p_year, 12, 31)
    on conflict (employee_id, year, type) do nothing
    returning 1
  )
  select count(*)::int into v_created from provisioned;

  if v_created > 0 then
    insert into activity_log (actor_id, employee_id, event_type, message, metadata)
    values (
      null, null, 'leave_provision',
      format('Provisioned %s paid-leave balance row(s) for %s', v_created, p_year),
      jsonb_build_object('year', p_year, 'created', v_created, 'carry_forward_cap', v_cap)
    );
  end if;

  return v_created;
end;
$$;

comment on function fn_provision_leave_balances(int) is
  'Creates the PL leave_balances rows for a year (single paid-leave pool from leave_annual_pl, '
  'plus capped carry-forward — cap is 0 under the leave-salary policy) for every employee still '
  'on the roster. Idempotent: existing rows are left untouched.';


-- ============================================================================
-- §4  OPTIONAL — top up the CURRENT year's PL from 12 to 15.
-- ----------------------------------------------------------------------------
-- Rows provisioned before this migration were credited 12 PL under the old
-- policy. This tops them up by the difference, once, with the audit row the
-- house rules demand. Idempotent: the fixed reason string is the guard.
--
-- >>> CONFIRM WITH THE OWNER BEFORE APPLYING. If the 15-day policy only starts
-- >>> NEXT year, delete this section before running the migration.
-- ============================================================================
with yr as (
  select extract(year from (now() at time zone 'Asia/Kolkata'))::int as y
),
todo as (
  select b.employee_id, b.year
    from leave_balances b, yr
   where b.year = yr.y
     and b.type = 'PL'
     and not exists (
       select 1 from leave_balance_adjustments a
        where a.employee_id = b.employee_id
          and a.year        = b.year
          and a.type        = 'PL'
          and a.reason      = 'Policy change: annual paid leave 12 -> 15'
     )
),
logged as (
  insert into leave_balance_adjustments (employee_id, year, type, delta, reason)
  select employee_id, year, 'PL'::leave_type, 3,
         'Policy change: annual paid leave 12 -> 15'
    from todo
  returning employee_id, year
)
update leave_balances b
   set balance = balance + 3
  from logged l
 where b.employee_id = l.employee_id
   and b.year        = l.year
   and b.type        = 'PL';
