-- ============================================================================
-- Dalnex HRMS — Payroll correctness + RLS hardening
-- ----------------------------------------------------------------------------
-- Fixes four defects found once the app was wired to the backend:
--   1. helpdesk_tickets leaked every employee's tickets to every employee.
--   2. payslip_adjustments were collected by the UI but never affected net pay.
--   3. fn_compute_run happily recomputed locked/paid runs, overwriting history.
--   4. The ESIC cap and full-day minutes were hardcoded in PL/pgSQL while also
--      being editable in Settings — so editing them did nothing.
-- ============================================================================

-- ================================================== 1. helpdesk RLS leak ===
-- Migration 0004 tightened reads on sensitive tables but omitted
-- helpdesk_tickets, so its 0003 policy (`using (is_authenticated())`) survived
-- and let any signed-in employee read all tickets — which contain payroll and
-- HR complaints. Scope it the same way 0004 scopes the other employee tables.
drop policy if exists helpdesk_tickets_read on helpdesk_tickets;

create policy helpdesk_tickets_read_portal on helpdesk_tickets
  for select using (is_portal());
create policy helpdesk_tickets_read_own on helpdesk_tickets
  for select using (employee_id = current_employee_id());

-- An employee may raise their own ticket (mirrors requests_employee_insert).
drop policy if exists helpdesk_tickets_employee_insert on helpdesk_tickets;
create policy helpdesk_tickets_employee_insert on helpdesk_tickets
  for insert with check (
    employee_id = current_employee_id() or is_portal()
  );

-- ============================================== 2. settings-driven rules ===
-- Read a numeric rule flag from `settings`, falling back to a default when the
-- key is absent. Keeps fn_compute_payslip honest about the Settings screen.
create or replace function fn_setting_numeric(p_key text, p_default numeric)
returns numeric
language sql stable as $$
  select coalesce(
    (select (value #>> '{}')::numeric from settings where key = p_key and branch_id is null),
    p_default
  );
$$;

-- ================================ 3. payslip compute: adjustments + rules ===
-- Recreated to (a) apply payslip_adjustments to net_payable and (b) source the
-- ESIC cap / full-day minutes from `settings` instead of hardcoded literals.
-- Everything else matches 0002 (PF 12% of earned Basic+DA; ESIC 0.75%/3.25%
-- under the cap; PT from pt_slabs).
create or replace function fn_compute_payslip(
  p_employee_id uuid,
  p_run_id      uuid
) returns void
language plpgsql as $$
declare
  e            employees%rowtype;
  st           indian_state;
  run          payroll_runs%rowtype;
  v_month      int;
  v_payable    numeric;
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
  v_adv        numeric := 0;   -- advance recovery      (deduct)
  v_loss       numeric := 0;   -- loss / damage         (deduct)
  v_lmb        numeric := 0;   -- last month balance    (+/-)
  v_bonus      numeric := 0;   -- reimbursement / bonus (add)
begin
  select * into e   from employees     where id = p_employee_id;
  select * into run from payroll_runs  where id = p_run_id;
  select state into st from branches where id = e.branch_id;

  v_month    := extract(month from run.period_month);
  days_in_mo := extract(day from (date_trunc('month', run.period_month) + interval '1 month - 1 day'));

  -- rule flags now come from Settings (fall back to the statutory defaults)
  esic_cap     := fn_setting_numeric('esic_gross_cap',   21000);
  full_day_min := fn_setting_numeric('full_day_minutes', 480);
  if full_day_min <= 0 then full_day_min := 480; end if;

  -- payable days = working days (paid leave counts, LWP does not) for the month
  select
    coalesce(count(*) filter (where status in ('P','LM','S','T')), 0)
      + 0.5 * coalesce(count(*) filter (where status = 'HD'), 0)
      + coalesce(count(*) filter (where status = 'L'), 0),
    coalesce(sum(worked_minutes), 0)
  into v_payable, v_worked
  from attendance_days
  where employee_id = p_employee_id
    and date_trunc('month', work_date) = run.period_month;

  v_target := coalesce(run.target_minutes, 0);

  -- earnings are pro-rated on days-in-month
  v_perday  := round(e.gross_monthly / days_in_mo, 2);
  v_basic_e := round(e.basic_da          / days_in_mo * v_payable, 2);
  v_hra_e   := round(e.hra               / days_in_mo * v_payable, 2);
  v_spl_e   := round(e.special_allowance / days_in_mo * v_payable, 2);
  v_earned  := v_basic_e + v_hra_e + v_spl_e;

  -- hours shortfall (proportional deduction on the day rate)
  if v_target > 0 and v_worked < v_target then
    v_short_min := v_target - v_worked;
    v_shortfall := round(v_perday / full_day_min * v_short_min, 0);
  end if;

  -- PF: 12% of earned Basic+DA (employer matches at the same rate)
  v_pf := round(v_basic_e * 0.12, 0);

  -- ESIC: only if monthly gross within the (settings-driven) cap
  if e.gross_monthly <= esic_cap then
    v_esic    := round(v_earned * 0.0075, 0);
    v_esic_er := round(v_earned * 0.0325, 0);
  end if;

  v_pt := fn_professional_tax(st, e.gross_monthly, e.gender, v_month);

  -- Manual adjustments, if HR has saved any against this payslip.
  select id into v_slip_id
    from payslips
   where payroll_run_id = p_run_id and employee_id = p_employee_id;

  if v_slip_id is not null then
    select coalesce(advance_recovery, 0), coalesce(loss_damage, 0),
           coalesce(last_month_balance, 0), coalesce(reimbursement_bonus, 0)
      into v_adv, v_loss, v_lmb, v_bonus
      from payslip_adjustments
     where id = v_slip_id;
  end if;

  -- net = earned - shortfall - statutory - recoveries + balance + reimbursements
  v_net := round(
      v_earned - v_shortfall - v_pf - v_esic - v_pt
      - coalesce(v_adv, 0) - coalesce(v_loss, 0)
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

-- ============================================ 4. lock guard on compute-run ===
-- A locked or paid run is history: recomputing it would silently rewrite issued
-- payslips. Raise instead of corrupting them.
create or replace function fn_compute_run(p_run_id uuid)
returns void language plpgsql as $$
declare
  r      record;
  v_stat payroll_status;
begin
  select status into v_stat from payroll_runs where id = p_run_id;

  if v_stat is null then
    raise exception 'Payroll run % does not exist', p_run_id;
  end if;

  if v_stat in ('locked', 'paid') then
    raise exception 'Payroll run % is % — recompute is not allowed after lock', p_run_id, v_stat;
  end if;

  for r in select id from employees where status = 'active' loop
    perform fn_compute_payslip(r.id, p_run_id);
  end loop;

  update payroll_runs
     set drafts_computed_at = now(),
         status = case when status = 'draft' then 'in_review' else status end
   where id = p_run_id;
end $$;

-- ------------------------------------------------------------ lock / pay ---
-- Freeze a run and mark its payslips generated. Idempotent-ish: only a run in
-- draft/in_review can be locked.
create or replace function fn_lock_run(p_run_id uuid)
returns void language plpgsql as $$
declare v_stat payroll_status;
begin
  select status into v_stat from payroll_runs where id = p_run_id;
  if v_stat is null then
    raise exception 'Payroll run % does not exist', p_run_id;
  end if;
  if v_stat in ('locked', 'paid') then
    raise exception 'Payroll run % is already %', p_run_id, v_stat;
  end if;

  update payslips
     set status = 'generated', updated_at = now()
   where payroll_run_id = p_run_id;

  update payroll_runs
     set status = 'locked', locked_at = now()
   where id = p_run_id;
end $$;

-- Mark a locked run paid.
create or replace function fn_mark_run_paid(p_run_id uuid)
returns void language plpgsql as $$
declare v_stat payroll_status;
begin
  select status into v_stat from payroll_runs where id = p_run_id;
  if v_stat is distinct from 'locked' then
    raise exception 'Payroll run % must be locked before it can be paid (is %)', p_run_id, v_stat;
  end if;

  update payslips
     set status = 'paid', updated_at = now()
   where payroll_run_id = p_run_id;

  update payroll_runs
     set status = 'paid', paid_at = now()
   where id = p_run_id;
end $$;
