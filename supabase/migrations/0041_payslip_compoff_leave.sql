-- ============================================================================
-- 0041 — Payslip "other deductions", leave-salary day overrides, comp-off
--        applicability, request review remarks, and "on leave today".
--
-- §1  payslip_adjustments.other_deductions — a catch-all deduction line the
--     payslip PDF shows alongside advance recovery and loss/damage.
--     fn_compute_payslip is re-issued (0011 body) to subtract it.
-- §2  leave_salary_workings.calendar_days_p1_override / _p2_override — HR may
--     type the calendar-day DENOMINATORS of the payable formula instead of
--     using real calendar arithmetic. NULL = automatic, the prior behaviour.
-- §3  comp_offs.is_applicable — staff can mark a credit not applicable; an
--     employee cannot apply against one until it is made applicable again.
-- §4  requests.review_remark — the approver's reason for approving/rejecting,
--     shown back to the employee. The employee-insert policy pins it null at
--     birth, like every other review column.
-- §5  fn_on_leave_today() — SECURITY DEFINER list of employees on approved
--     leave today, so the employee dashboard can show "On Leave Today" names
--     without widening RLS on requests/employees.
-- ============================================================================


-- ============================================================== §1 payslip ---
alter table payslip_adjustments
  add column if not exists other_deductions numeric(12,2) not null default 0;

comment on column payslip_adjustments.other_deductions is
  'Miscellaneous deductions (uniform, canteen, penalties …) shown as one line on the payslip. Subtracted from net_payable by fn_compute_payslip.';

-- Re-issue fn_compute_payslip (0011 body) with other_deductions in the net.
create or replace function fn_compute_payslip(
  p_employee_id uuid,
  p_run_id      uuid
) returns void
language plpgsql
set search_path = public
as $$
declare
  e            employees%rowtype;
  st           indian_state;
  run          payroll_runs%rowtype;
  v_month      int;
  v_working    numeric;     -- register col AP
  v_wo         numeric;     -- week-offs in the month
  v_payable    numeric;     -- register col AQ = working + WO
  v_worked     int;
  v_target     int;
  v_perday     numeric;
  v_basic_e    numeric;
  v_hra_e      numeric;
  v_spl_e      numeric;
  v_earned     numeric;
  v_pf         numeric;
  v_esic       numeric := 0;
  v_esic_er    numeric := 0;
  v_pt         numeric;
  v_short_min  int := 0;
  v_shortfall  numeric := 0;
  v_net        numeric;
  esic_cap     numeric;
  full_day_min numeric;
  days_in_mo   int;
  v_slip_id    uuid;
  v_adv        numeric := 0;
  v_loss       numeric := 0;
  v_lmb        numeric := 0;
  v_bonus      numeric := 0;
  v_other      numeric := 0;
begin
  select * into e   from employees    where id = p_employee_id;
  select * into run from payroll_runs where id = p_run_id;
  select state into st from branches where id = e.branch_id;

  v_month    := extract(month from run.period_month);
  days_in_mo := extract(day from (date_trunc('month', run.period_month) + interval '1 month - 1 day'));

  esic_cap     := fn_setting_numeric('esic_gross_cap',   21000);
  full_day_min := fn_setting_numeric('full_day_minutes', 555);
  if full_day_min <= 0 then full_day_min := 555; end if;

  -- Register col AP: working days = P + CO + 0.5*HD + OH + T + S + LM
  -- Register col AQ: payable days = working days + WO   (week-offs ARE paid)
  -- Leave (L) is NOT a payable day here — the register excludes it.
  select
    coalesce(count(*) filter (where status in ('P','CO','OH','T','S','LM')), 0)
      + 0.5 * coalesce(count(*) filter (where status = 'HD'), 0),
    coalesce(count(*) filter (where status = 'WO'), 0),
    coalesce(sum(worked_minutes), 0)
  into v_working, v_wo, v_worked
  from attendance_days
  where employee_id = p_employee_id
    and date_trunc('month', work_date) = run.period_month;

  v_payable := v_working + v_wo;

  -- Per-EMPLOYEE target: the days they were actually scheduled to work.
  v_target := round(v_working * full_day_min)::int;

  -- earnings are pro-rated on days-in-month
  v_perday  := round(e.gross_monthly / days_in_mo, 2);
  v_basic_e := round(e.basic_da          / days_in_mo * v_payable, 2);
  v_hra_e   := round(e.hra               / days_in_mo * v_payable, 2);
  v_spl_e   := round(e.special_allowance / days_in_mo * v_payable, 2);
  v_earned  := v_basic_e + v_hra_e + v_spl_e;

  -- Shortfall only when they genuinely under-worked their own target.
  if v_target > 0 and v_worked < v_target then
    v_short_min := v_target - v_worked;
    -- floor(), matching the register's own rounding (DN002: 21, not 22)
    v_shortfall := floor(v_perday / full_day_min * v_short_min);
  end if;

  v_pf := round(v_basic_e * 0.12, 0);

  if e.gross_monthly <= esic_cap then
    v_esic    := round(v_earned * 0.0075, 0);
    v_esic_er := round(v_earned * 0.0325, 0);
  end if;

  v_pt := fn_professional_tax(st, e.gross_monthly, e.gender, v_month);

  select id into v_slip_id
    from payslips
   where payroll_run_id = p_run_id and employee_id = p_employee_id;

  if v_slip_id is not null then
    select coalesce(advance_recovery, 0), coalesce(loss_damage, 0),
           coalesce(last_month_balance, 0), coalesce(reimbursement_bonus, 0),
           coalesce(other_deductions, 0)
      into v_adv, v_loss, v_lmb, v_bonus, v_other
      from payslip_adjustments
     where id = v_slip_id;
  end if;

  v_net := round(
      v_earned - v_shortfall - v_pf - v_esic - v_pt
      - coalesce(v_adv, 0) - coalesce(v_loss, 0) - coalesce(v_other, 0)
      + coalesce(v_lmb, 0) + coalesce(v_bonus, 0)
    , 0);

  insert into payslips (
    payroll_run_id, employee_id, payable_days, worked_minutes, target_minutes,
    shortfall_minutes, per_day_rate, basic_earned, hra_earned, special_earned,
    earned_gross, shortfall_amount, pf_employee, pf_employer, esic_employee,
    esic_employer, professional_tax, net_payable, status
  ) values (
    p_run_id, p_employee_id, v_payable, v_worked, v_target,
    v_short_min, v_perday, v_basic_e, v_hra_e, v_spl_e,
    v_earned, v_shortfall, v_pf, v_pf, v_esic,
    v_esic_er, v_pt, v_net, 'draft'
  )
  on conflict (payroll_run_id, employee_id) do update set
    payable_days = excluded.payable_days,
    worked_minutes = excluded.worked_minutes,
    target_minutes = excluded.target_minutes,
    shortfall_minutes = excluded.shortfall_minutes,
    per_day_rate = excluded.per_day_rate,
    basic_earned = excluded.basic_earned,
    hra_earned = excluded.hra_earned,
    special_earned = excluded.special_earned,
    earned_gross = excluded.earned_gross,
    shortfall_amount = excluded.shortfall_amount,
    pf_employee = excluded.pf_employee,
    pf_employer = excluded.pf_employer,
    esic_employee = excluded.esic_employee,
    esic_employer = excluded.esic_employer,
    professional_tax = excluded.professional_tax,
    net_payable = excluded.net_payable,
    updated_at = now();
end $$;

comment on function fn_compute_payslip(uuid, uuid) is
  'Payable days = working days (P+CO+0.5*HD+OH+T+S+LM) + WO, per the company monthly '
  'register cols AP/AQ. Target minutes are PER EMPLOYEE (working days x full_day_minutes, '
  'default 555 = 9h15m). Net subtracts advance_recovery, loss_damage and other_deductions '
  'and adds last_month_balance / reimbursement_bonus from payslip_adjustments. See 0007/0041.';


-- ======================================================== §2 leave salary ---
alter table leave_salary_workings
  add column if not exists calendar_days_p1_override integer
  check (calendar_days_p1_override is null
         or (calendar_days_p1_override >= 1 and calendar_days_p1_override <= 366));
alter table leave_salary_workings
  add column if not exists calendar_days_p2_override integer
  check (calendar_days_p2_override is null
         or (calendar_days_p2_override >= 1 and calendar_days_p2_override <= 366));

comment on column leave_salary_workings.calendar_days_p1_override is
  'HR-entered calendar-day denominator for the pre-increment period (payable = entitled × present ÷ days). NULL = real calendar days (the default).';
comment on column leave_salary_workings.calendar_days_p2_override is
  'HR-entered calendar-day denominator for the post-increment period. NULL = real calendar days (the default).';


-- ============================================================ §3 comp offs ---
alter table comp_offs
  add column if not exists is_applicable boolean not null default true;

comment on column comp_offs.is_applicable is
  'Staff switch: false = the credit is on hold and an employee cannot apply against it. Availing (status=used) and expiry retire a credit regardless of this flag.';


-- ============================================================ §4 requests ---
alter table requests
  add column if not exists review_remark text;

comment on column requests.review_remark is
  'The approver''s reason for the approval/rejection, shown to the employee.';

-- A request must be BORN without a review remark, exactly like the other
-- review columns (0013). Recreate the insert policy with the extra pin.
drop policy if exists requests_employee_insert on requests;
create policy requests_employee_insert on requests
  for insert with check (
    employee_id = current_employee_id()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and balance_after is null
    and review_remark is null
  );


-- ====================================================== §5 on leave today ---
-- Who is on APPROVED leave today (IST). SECURITY DEFINER on purpose: employee
-- RLS scopes `requests` to the caller's own rows, but the dashboard's
-- "On Leave Today" strip needs colleagues' names. This exposes exactly four
-- benign fields (name, branch, leave span) to signed-in users and nothing else.
create or replace function fn_on_leave_today()
returns table (
  employee_id uuid,
  full_name   text,
  branch      text,
  start_date  date,
  end_date    date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if auth.uid() is null then
    raise exception 'fn_on_leave_today: not signed in' using errcode = '42501';
  end if;

  return query
    select e.id, e.full_name, coalesce(b.name, ''), r.start_date, r.end_date
      from requests r
      join employees e on e.id = r.employee_id
      left join branches b on b.id = e.branch_id
     where r.type = 'leave'
       and r.status = 'approved'
       and r.start_date <= v_today
       and r.end_date   >= v_today
       and e.status in ('active', 'on_notice')
     order by e.full_name;
end $$;

comment on function fn_on_leave_today() is
  'Names/branches of employees on approved leave today (IST). SECURITY DEFINER so every signed-in user can see the list; gated to authenticated callers in-body.';

revoke all on function fn_on_leave_today() from public;
revoke all on function fn_on_leave_today() from anon;
grant execute on function fn_on_leave_today() to authenticated;
