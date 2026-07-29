-- ============================================================================
-- 0036 — Leave & comp-off engine: entitlement, carry-forward, expiry,
-- encashment, manual adjustments and multi-level approvals.
--
-- Leave has been a set of numbers someone typed in. leave_balances rows are
-- created by hand (or not at all — reviewRequest silently draws down nothing
-- when the row is missing, so an employee can take unlimited "paid" leave and
-- the register never notices), balances never roll into the next year, a manual
-- correction leaves no trace of who changed what, comp_off_status.'expired' has
-- existed since 0009 but is NEVER written (a credit earned in 2024 is still
-- spendable today), and every request is a single yes/no by whichever staff
-- user opened /approvals first. This migration closes all five gaps:
--
--   * leave_balance_adjustments — every manual credit/debit gets an actor and a
--     mandatory reason, so a balance that "moved on its own" is explainable.
--   * comp_offs.expires_on + fn_expire_comp_offs() on pg_cron — credits now have
--     a shelf life and lapse ONCE, with the employee told.
--   * fn_provision_leave_balances(year) — opens a year for every employee still
--     on the roster from settings, carrying last year''s remainder up to a cap.
--     Safe to re-run: on conflict do nothing, so a second call never
--     double-credits.
--   * leave_encashment — the paperwork trail for buying leave back.
--   * approval_steps — an ordered, per-role approval chain per request.
--
-- Everything numeric is a settings key (§1) rather than a constant, because the
-- entitlement is a policy decision HR changes without a deploy.
--
-- No enum is altered here: comp_off_status already carries 'expired' (0009),
-- notification_kind already carries 'comp_off' (0012), employee_status already
-- carries 'on_notice' (0001) and app_role already carries 'manager'/'hr'/'admin'
-- (0001), so all of them are usable in THIS transaction. Nothing in this file
-- needs the add-value-then-wait dance.
--
-- Every function below is SECURITY DEFINER (they write leave_balances,
-- notifications and activity_log, all of which are RLS-protected), and Postgres
-- grants EXECUTE to PUBLIC by default — so a bare
-- `revoke execute ... from anon, authenticated` would NOT close them; the PUBLIC
-- grant survives it. They therefore carry an in-body authorisation gate instead,
-- using the same trusted-path test as 0013: auth.uid() is null on the pg_cron /
-- service-role path, non-null and role-checked for anything arriving through
-- PostgREST. Without it, any signed-in employee could call
-- fn_provision_leave_balances(2200) in a loop from a devtools console and fill
-- leave_balances with junk — 0013 §1 is emphatic that the Server Actions are not
-- the security boundary.
-- ============================================================================


-- ============================================================================
-- §1  SETTINGS — the policy knobs every function below reads.
-- ----------------------------------------------------------------------------
-- Seeded, never overwritten (on conflict do nothing): re-running the migration
-- must not stomp a value HR has since tuned on the Settings screen.
-- ============================================================================
insert into settings (key, value, label, description) values
  ('leave_annual_pl', '12'::jsonb,
   'Annual PL entitlement',
   'Privilege/earned leave days credited to each employee still on the roster (active or serving notice) when a leave year is provisioned.'),

  ('leave_annual_cl', '7'::jsonb,
   'Annual CL entitlement',
   'Casual leave days credited to each employee still on the roster (active or serving notice) when a leave year is provisioned.'),

  ('leave_annual_sl', '7'::jsonb,
   'Annual SL entitlement',
   'Sick leave days credited to each employee still on the roster (active or serving notice) when a leave year is provisioned.'),

  ('leave_carry_forward_cap', '15'::jsonb,
   'Carry-forward cap (days)',
   'Maximum unused days carried from one leave year into the next, per leave type. Set to 0 to make balances lapse at year end.'),

  ('leave_sandwich_policy', 'false'::jsonb,
   'Sandwich leave policy',
   'When on, week-offs and holidays falling BETWEEN two leave days are counted as leave. Applied by the day-count when a request is filed.'),

  ('comp_off_validity_days', '90'::jsonb,
   'Comp-off validity (days)',
   'Days a comp-off credit stays available after the off day that earned it. Unused credits expire automatically past this window.'),

  ('leave_approval_levels', '1'::jsonb,
   'Leave approval levels',
   'How many sequential approvals a leave request needs (1 = manager only, 2 = manager then HR, 3 = manager, HR, then admin).')
on conflict (key) do nothing;


-- ============================================================================
-- §2  leave_balance_adjustments — audit trail for manual balance edits.
-- ----------------------------------------------------------------------------
-- leave_balances holds only a running number, so an HR correction (joining
-- pro-rata, an encashment debit, a goodwill credit) was indistinguishable from
-- a bug. Each adjustment is recorded as a signed delta with a MANDATORY reason;
-- the sum of deltas for a (employee, year, type) reconciles the balance against
-- what provisioning + approvals should have produced.
--
-- Append-only by intent: there is no staff UPDATE/DELETE path in the app, but
-- RLS grants staff `for all` so a genuine data-fix stays possible.
-- ============================================================================
create table if not exists leave_balance_adjustments (
  id          uuid       primary key default gen_random_uuid(),
  employee_id uuid       not null references employees(id) on delete cascade,
  year        integer    not null,
  type        leave_type not null,
  -- Signed: positive credits the employee, negative debits. Never 0 — a
  -- no-op adjustment is a mistake, not a record worth keeping.
  delta       numeric(4,1) not null check (delta <> 0),
  reason      text       not null check (length(btrim(reason)) > 0),
  actor_id    uuid       references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists leave_balance_adjustments_emp_idx
  on leave_balance_adjustments (employee_id, year, type);
create index if not exists leave_balance_adjustments_time_idx
  on leave_balance_adjustments (created_at desc);

comment on table leave_balance_adjustments is
  'Audit of manual credits/debits against leave_balances. Every row carries who did it and why; '
  'the deltas explain any difference between a provisioned balance and the current one.';
comment on column leave_balance_adjustments.delta is
  'Signed day count: positive = credit, negative = debit. The balance itself still lives on leave_balances.';

alter table leave_balance_adjustments enable row level security;

drop policy if exists leave_balance_adjustments_staff_all on leave_balance_adjustments;
create policy leave_balance_adjustments_staff_all on leave_balance_adjustments
  for all using (is_staff()) with check (is_staff());

-- Additive read-own: an employee must be able to see why their balance moved,
-- otherwise the audit trail only reassures the people who already knew.
drop policy if exists leave_balance_adjustments_read_own on leave_balance_adjustments;
create policy leave_balance_adjustments_read_own on leave_balance_adjustments
  for select using (employee_id = current_employee_id());


-- ============================================================================
-- §3  COMP-OFF EXPIRY — give credits a shelf life and lapse them once.
-- ----------------------------------------------------------------------------
-- comp_offs has always had an 'expired' status that nothing ever wrote, so the
-- register carries credits from years ago that payroll would still honour. An
-- expires_on date plus a nightly sweep fixes that; the notification means a
-- credit never vanishes silently.
-- ============================================================================
alter table comp_offs add column if not exists expires_on date;

comment on column comp_offs.expires_on is
  'Last day the credit may be applied for. Defaulted from settings.comp_off_validity_days on insert; '
  'fn_expire_comp_offs() lapses available credits once this date has passed.';

-- Backfill. Historic credits are dated from their earned day, EXCEPT the ones
-- still available: those get at least a 30-day grace window. Without it the
-- very first sweep would expire years of accumulated credits overnight and fan
-- out a notification storm for balances people are actively counting on.
update comp_offs
   set expires_on = case
         when status = 'available'
           then greatest(
                  earned_date + greatest(fn_setting_numeric('comp_off_validity_days', 90), 1)::int,
                  current_date + 30
                )
         else earned_date + greatest(fn_setting_numeric('comp_off_validity_days', 90), 1)::int
       end
 where expires_on is null;

-- Every FUTURE credit gets its expiry at insert time, in the database rather
-- than in the granting action. The failure mode this prevents: a code path that
-- forgets to set expires_on inserts an immortal credit the sweep can never see
-- (the sweep only touches rows with a non-null date).
create or replace function fn_comp_off_default_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.expires_on is null then
    new.expires_on := new.earned_date
      + greatest(fn_setting_numeric('comp_off_validity_days', 90), 1)::int;
  end if;
  return new;
end;
$$;

-- Same reasoning as 0024 §2: a trigger function is not meant to be RPC-callable.
-- (Revoking EXECUTE does not affect trigger firing — triggers run as the table
-- owner and the privilege is only checked at CREATE TRIGGER time.)
revoke execute on function public.fn_comp_off_default_expiry() from anon, authenticated;

drop trigger if exists comp_offs_set_expiry on comp_offs;
create trigger comp_offs_set_expiry
  before insert on comp_offs
  for each row execute function fn_comp_off_default_expiry();

-- The sweep only ever scans available credits; keeping the index partial keeps
-- it tiny as used/expired history piles up.
create index if not exists comp_offs_expiry_idx
  on comp_offs (expires_on)
  where status = 'available';

-- Flip lapsed credits to 'expired' and tell each affected employee once.
-- Claimed per IST day, so a manual re-run, a duplicate cron fire or a retry
-- after a restart cannot re-notify anyone. Returns the number of credits lapsed.
create or replace function fn_expire_comp_offs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today   date    := (now() at time zone 'Asia/Kolkata')::date;
  v_expired integer := 0;
begin
  -- Authorisation (see the file header): SECURITY DEFINER + the default PUBLIC
  -- EXECUTE grant means this is reachable over PostgREST by any signed-in user.
  -- auth.uid() is null on the pg_cron / service-role path — the only caller this
  -- is written for — and staff may also run it by hand from the Settings screen.
  if auth.uid() is not null and not coalesce(is_staff(), false) then
    raise exception 'Not permitted: fn_expire_comp_offs is a scheduled/staff operation.'
      using errcode = '42501';
  end if;

  if not cron_claim('comp_off_expiry', v_today::text, 'daily comp-off expiry sweep') then
    return 0;
  end if;

  with lapsed as (
    update comp_offs c
       set status = 'expired'
     where c.status = 'available'
       and c.expires_on is not null
       and c.expires_on < v_today
    returning c.employee_id, c.earned_date, c.expires_on
  ),
  -- One notification per employee, not per credit: an employee losing six
  -- stale credits should get one line in their bell, not six.
  per_employee as (
    select employee_id,
           count(*)::int as credits,
           min(earned_date) as first_earned,
           max(expires_on)  as last_valid
      from lapsed
     group by employee_id
  ),
  -- Data-modifying CTE: Postgres runs it exactly once and to completion even
  -- though the primary query never reads `notified`, and its dependency on
  -- per_employee -> lapsed pins the ordering. per_employee is referenced twice,
  -- so it is materialised once and the counts cannot be double-taken.
  notified as (
    insert into notifications (recipient_id, kind, title, body, link)
    select p.id,
           'comp_off',
           'Comp-off credit expired',
           format(
             '%s comp-off credit(s) earned from %s expired (last valid %s) and can no longer be applied for.',
             pe.credits, pe.first_earned, pe.last_valid
           ),
           '/me'
      from per_employee pe
      join profiles p on p.employee_id = pe.employee_id
    returning 1
  )
  select coalesce(sum(credits), 0) into v_expired from per_employee;

  if v_expired > 0 then
    insert into activity_log (actor_id, employee_id, event_type, message, metadata)
    values (
      null, null, 'comp_off_expiry',
      format('Comp-off sweep expired %s credit(s) on %s', v_expired, v_today),
      jsonb_build_object('run_date', v_today, 'expired', v_expired, 'source', 'pg_cron')
    );
  end if;

  return v_expired;
end;
$$;

comment on function fn_expire_comp_offs() is
  'Daily sweep: available comp-off credits past expires_on become ''expired'' and the owner is notified. '
  'Guarded by cron_claim(''comp_off_expiry'', <IST date>) so it does the work at most once per day.';

-- 01:30 UTC = 07:00 IST — before anyone opens the portal, so a credit that
-- lapsed overnight is already reflected the first time it is looked at.
select cron.schedule(
  'comp-off-expiry',
  '30 1 * * *',
  $cron$ select fn_expire_comp_offs(); $cron$
);


-- ============================================================================
-- §4  PROVISIONING + CARRY-FORWARD — open a leave year in one call.
-- ----------------------------------------------------------------------------
-- Creates the missing leave_balances rows for a year: annual entitlement from
-- §1 plus last year''s unused days, capped. Idempotent through the existing
-- unique (employee_id, year, type) — a second run for the same year inserts
-- nothing, which is what makes it safe to schedule AND safe to press a button.
--
-- Deliberately NOT pro-rated for mid-year joiners: a joiner correction belongs
-- in leave_balance_adjustments (§2) where it carries a reason and an actor,
-- rather than being silently baked into an opening balance nobody can explain.
-- ============================================================================
create or replace function fn_provision_leave_balances(p_year int)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Floored at 0 so a negative cap cannot turn carry-forward into a debit.
  v_cap     numeric := greatest(fn_setting_numeric('leave_carry_forward_cap', 15), 0);
  v_created integer := 0;
begin
  -- Authorisation (see the file header). This one matters most: unguarded, any
  -- signed-in employee could call it for every year in the allowed range and
  -- bulk-insert leave_balances rows for the whole company from a browser.
  if auth.uid() is not null and not coalesce(is_staff(), false) then
    raise exception 'Not permitted: only staff (or the scheduler) may provision a leave year.'
      using errcode = '42501';
  end if;

  -- A typo like 202 or 20266 would create a phantom leave year that quietly
  -- competes with the real one; refuse rather than pollute the table.
  if p_year is null or p_year < 2000 or p_year > 2200 then
    raise exception 'fn_provision_leave_balances: implausible year %', p_year;
  end if;

  with entitlement (type, annual) as (
    values ('PL'::leave_type, fn_setting_numeric('leave_annual_pl', 12)),
           ('CL'::leave_type, fn_setting_numeric('leave_annual_cl', 7)),
           ('SL'::leave_type, fn_setting_numeric('leave_annual_sl', 7))
    -- LWP is loss-of-pay: it is a request kind, never an entitlement, so it is
    -- intentionally absent. reviewRequest already skips it on drawdown.
  ),
  provisioned as (
    insert into leave_balances (employee_id, year, type, balance)
    select e.id,
           p_year,
           t.type,
           round(
             t.annual
             -- Carry-forward: last year''s REMAINING balance (leave_balances is
             -- drawn down on approval), floored at 0 so an over-drawn balance
             -- never follows an employee into the new year, capped at v_cap.
             + least(greatest(coalesce(prev.balance, 0), 0), v_cap),
             1
           )
      from employees e
      cross join entitlement t
      left join leave_balances prev
        on prev.employee_id = e.id
       and prev.year        = p_year - 1
       and prev.type        = t.type
       -- 'on_notice' is on the roster, not off it: someone serving notice still
       -- works, still takes leave, and usually encashes the remainder on exit.
       -- Provisioning only 'active' would leave them with NO leave_balances row,
       -- which is the exact hole this migration exists to close (a missing row
       -- means reviewRequest draws down nothing and the leave is effectively
       -- free). 'inactive' — exited — is correctly excluded.
     where e.status in ('active', 'on_notice')
       -- Someone who joins after the year is over has no claim on it.
       and e.date_of_joining <= make_date(p_year, 12, 31)
    on conflict (employee_id, year, type) do nothing
    returning 1
  )
  select count(*)::int into v_created from provisioned;

  if v_created > 0 then
    insert into activity_log (actor_id, employee_id, event_type, message, metadata)
    values (
      null, null, 'leave_provision',
      format('Provisioned %s leave balance row(s) for %s', v_created, p_year),
      jsonb_build_object('year', p_year, 'created', v_created, 'carry_forward_cap', v_cap)
    );
  end if;

  return v_created;
end;
$$;

comment on function fn_provision_leave_balances(int) is
  'Creates the leave_balances rows for a year (annual entitlement from settings + capped carry-forward '
  'of the prior year''s remainder) for every employee still on the roster (active or on notice). '
  'Idempotent: existing rows are left untouched.';

-- Runs 1–7 January rather than only on the 1st: the cron_claim key is the YEAR,
-- so the first successful run provisions and days 2–7 are no-ops. A database
-- that happened to be down at 01:00 on 1 Jan still opens the year on time.
select cron.schedule(
  'leave-annual-provision',
  '0 1 1-7 1 *',
  $cron$
    select case
      when cron_claim('leave_provision',
                      extract(year from (now() at time zone 'Asia/Kolkata'))::int::text)
      then fn_provision_leave_balances(extract(year from (now() at time zone 'Asia/Kolkata'))::int)
      else 0
    end;
  $cron$
);


-- ============================================================================
-- §5  leave_encashment — the record behind paying leave out.
-- ----------------------------------------------------------------------------
-- Encashment currently happens as an ad-hoc payslip_adjustment with a free-text
-- narration, so there is no link back to the days surrendered and no way to
-- answer "how much PL have we bought back this year". This table is that link:
-- requested -> approved -> paid, with the day count and the rupee amount kept
-- apart so the rate used stays visible.
--
-- The matching DEBIT on leave_balances is written as a leave_balance_adjustments
-- row (§2) by the approving action — the days are only surrendered on approval,
-- exactly as leave itself is only drawn down on approval.
-- ============================================================================
create table if not exists leave_encashment (
  id           uuid       primary key default gen_random_uuid(),
  employee_id  uuid       not null references employees(id) on delete cascade,
  year         integer    not null,
  type         leave_type not null,
  days         numeric(4,1)  not null check (days > 0),
  amount       numeric(12,2) not null default 0 check (amount >= 0),
  status       text not null default 'requested'
                 check (status in ('requested', 'approved', 'paid')),
  requested_at timestamptz not null default now(),
  approved_by  uuid references profiles(id) on delete set null,
  approved_at  timestamptz,
  remarks      text
);

create index if not exists leave_encashment_emp_idx
  on leave_encashment (employee_id, year);
create index if not exists leave_encashment_status_idx
  on leave_encashment (status, requested_at desc);

comment on table leave_encashment is
  'Leave-encashment requests: days surrendered, amount payable, and the approve/pay trail. '
  'The balance debit itself is recorded in leave_balance_adjustments on approval.';
comment on column leave_encashment.amount is
  'Rupee value of the encashed days, computed at approval time so a later salary revision does not rewrite history.';

alter table leave_encashment enable row level security;

-- Staff file, approve and pay. There is deliberately no employee INSERT policy:
-- encashment is initiated by HR today. If self-service filing is added later it
-- needs an ADDITIVE insert policy pinned to status = 'requested' with
-- approved_by/approved_at null, so a request can never arrive pre-approved.
drop policy if exists leave_encashment_staff_all on leave_encashment;
create policy leave_encashment_staff_all on leave_encashment
  for all using (is_staff()) with check (is_staff());

drop policy if exists leave_encashment_read_own on leave_encashment;
create policy leave_encashment_read_own on leave_encashment
  for select using (employee_id = current_employee_id());


-- ============================================================================
-- §6  approval_steps — ordered multi-level approvals for a request.
-- ----------------------------------------------------------------------------
-- Today any one of admin/hr/manager can approve any request outright, so a
-- manager''s sign-off and HR''s sign-off are the same event and neither is
-- recorded separately. This adds an explicit chain: step 1 must be decided
-- before step 2 is actionable, each step remembers its approver, timestamp and
-- remark, and requests.status stays the FINAL outcome (unchanged for everyone
-- reading it today — with leave_approval_levels = 1 the behaviour is identical
-- to the current single-approval flow).
--
-- The chain cascades with its request: a deleted request must not leave orphan
-- approvals sitting in an approver''s queue.
-- ============================================================================
create table if not exists approval_steps (
  id           uuid    primary key default gen_random_uuid(),
  request_id   uuid    not null references requests(id) on delete cascade,
  step_no      integer not null check (step_no > 0),
  approver_role app_role not null,
  status       request_status not null default 'pending',
  approver_id  uuid references profiles(id) on delete set null,
  decided_at   timestamptz,
  remark       text,
  created_at   timestamptz not null default now(),
  -- One step per level per request: the guard against a double-seed creating
  -- two "step 2"s that both need deciding.
  unique (request_id, step_no)
);

create index if not exists approval_steps_request_idx
  on approval_steps (request_id, step_no);
-- Drives the approver queue ("what is waiting on my role"); partial so it stays
-- small — decided steps are history, never queue.
create index if not exists approval_steps_pending_idx
  on approval_steps (approver_role, status)
  where status = 'pending';

comment on table approval_steps is
  'Ordered approval chain for a request. Step N is only actionable once step N-1 is approved; '
  'requests.status remains the final outcome of the whole chain.';
comment on column approval_steps.approver_role is
  'The role expected to decide this step. Which staff user may act is enforced in the action layer, not by RLS.';

alter table approval_steps enable row level security;

-- Staff manage the chain. RLS draws only the staff/employee line here, matching
-- every other approval surface in this schema; step ordering and role matching
-- are application invariants (a policy cannot express "step 1 is decided").
drop policy if exists approval_steps_staff_all on approval_steps;
create policy approval_steps_staff_all on approval_steps
  for all using (is_staff()) with check (is_staff());

-- Read-own through the parent request: an employee should be able to see where
-- their leave is stuck, which is the whole point of a visible chain.
drop policy if exists approval_steps_read_own on approval_steps;
create policy approval_steps_read_own on approval_steps
  for select using (
    exists (
      select 1 from requests r
       where r.id = approval_steps.request_id
         and r.employee_id = current_employee_id()
    )
  );

-- Build the chain for a request from settings.leave_approval_levels. Called
-- when a request is filed; idempotent (on conflict do nothing), so a retry
-- after a failed submit cannot duplicate a level. Returns the number of steps
-- created. Level order is manager -> hr -> admin, and anything beyond level 3
-- also lands on admin (there is no higher authority in app_role).
create or replace function fn_init_approval_steps(p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Clamped: 0 levels would leave a request nobody can approve, and an absurd
  -- value would spawn a chain no one can clear.
  v_levels integer := least(greatest(fn_setting_numeric('leave_approval_levels', 1)::int, 1), 5);
  v_made   integer := 0;
begin
  if p_request_id is null then
    return 0;
  end if;

  -- Authorisation (see the file header). Unlike the two sweeps, employees DO
  -- legitimately reach this — filing their own request seeds the chain — so the
  -- gate is "scheduler/service, staff, or the owner of this request", never
  -- "any signed-in user, any request id". The ownership lookup runs as the
  -- definer on purpose: it must see the real row, not an RLS-filtered view.
  if auth.uid() is not null
     and not coalesce(is_staff(), false)
     and not exists (
       select 1 from requests r
        where r.id = p_request_id
          and r.employee_id = current_employee_id()
     )
  then
    raise exception 'Not permitted: an approval chain may only be seeded for your own request.'
      using errcode = '42501';
  end if;

  with steps as (
    insert into approval_steps (request_id, step_no, approver_role)
    select p_request_id,
           n,
           case n when 1 then 'manager'::app_role
                  when 2 then 'hr'::app_role
                  else        'admin'::app_role
           end
      from generate_series(1, v_levels) as n
    on conflict (request_id, step_no) do nothing
    returning 1
  )
  select count(*)::int into v_made from steps;

  return v_made;
end;
$$;

comment on function fn_init_approval_steps(uuid) is
  'Seeds the approval chain (manager -> hr -> admin) for a request from settings.leave_approval_levels. '
  'Idempotent: re-calling for the same request adds nothing.';
