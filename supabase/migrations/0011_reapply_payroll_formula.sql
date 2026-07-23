-- ============================================================================
-- 0011 — Re-apply the 0007 payroll formula (corrective).
--
-- WHY THIS EXISTS
-- ---------------
-- The production database was originally provisioned from the old
-- `setup_hosted.sql`, which was a concatenation of migrations 0001..0006 only.
-- Migration 0007 — the payable-days / per-employee-target correction — therefore
-- never ran there, even though the file existed in the repo. Symptoms observed
-- on 2026-07-21 before this migration:
--
--     settings.full_day_minutes = 480        (0007 sets it to 555)
--     payslips.target_minutes   = 12488 for EVERY employee   (flat run-level
--                                 target; 0007 makes it per-employee)
--     DN001 payable 23.5 net Rs.32,935       (correct: 28.5 / Rs.39,985)
--     DN004 shortfall 5,074 min              (phantom part-timer shortfall)
--
-- i.e. every employee was being under-paid by roughly a week of week-offs.
--
-- 0007 is marked applied in supabase_migrations.schema_migrations, so it will
-- not be replayed. Rather than rewrite migration history, this forward migration
-- re-applies 0007's contents verbatim. Every statement in it is idempotent
-- (UPDATE / INSERT..WHERE NOT EXISTS / CREATE OR REPLACE FUNCTION / COMMENT),
-- so running it on a database that DID get 0007 is a harmless no-op.
--
-- NOTE: this only fixes the FORMULA. Existing payslip rows keep their old
-- numbers until the run is recomputed (fn_compute_run / "Recompute drafts").
-- ============================================================================



-- --------------------------------------------------------------- settings ---
-- The register's daily requirement is 9:15 (9.25h = 555 min), not 8h.
-- fn_compute_payslip reads this via fn_setting_numeric (added in 0005), so the
-- Settings screen stays the single source of truth.
update settings
   set value = '555'::jsonb,
       label = 'Full-day minutes',
       description = 'Minutes in a full working day (9h15m per the monthly register). Drives per-employee target minutes and the shortfall rate.',
       updated_at = now()
 where key = 'full_day_minutes';

insert into settings (key, value, label, description)
select 'full_day_minutes', '555'::jsonb, 'Full-day minutes',
       'Minutes in a full working day (9h15m per the monthly register).'
where not exists (select 1 from settings where key = 'full_day_minutes');

-- ------------------------------------------------------- compute payslip ---
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
  -- (Previously run.target_minutes — one flat number for everyone.)
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
           coalesce(last_month_balance, 0), coalesce(reimbursement_bonus, 0)
      into v_adv, v_loss, v_lmb, v_bonus
      from payslip_adjustments
     where id = v_slip_id;
  end if;

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

comment on function fn_compute_payslip(uuid, uuid) is
  'Payable days = working days (P+CO+0.5*HD+OH+T+S+LM) + WO, per the company monthly '
  'register cols AP/AQ. Target minutes are PER EMPLOYEE (working days x full_day_minutes, '
  'default 555 = 9h15m), not the run-level payroll_runs.target_minutes, which is now unused '
  'by this function and retained only for display. See migration 0007.';

-- ============================================================================
-- KNOWN DIVERGENCE — DN004 (Sneha Patel)
-- ----------------------------------------------------------------------------
-- This function computes her working days as 14.5 (4 P + 0.5 x 21 HD), giving
-- target 8,048 and a real 634-min shortfall. The source spreadsheet states
-- working days = 15 and target 5,828 min (= 10.5 x 555) with ZERO shortfall.
-- Neither reconciles with the sheet's own stated formula:
--   * 4 + 0.5*21 = 14.5, yet col AP says 15   (the sheet is self-inconsistent)
--   * 5,828 / 555 = 10.5, which equals 21 HD x 0.5 and silently drops her 4 P days
-- DN001/DN002/DN003 all reproduce the sheet exactly under this function, so the
-- rule here is believed correct and DN004's sheet row is believed to be a manual
-- fudge. FLAGGED FOR HR REVIEW — do not "fix" the formula to chase DN004 without
-- confirming how half-day targets are actually meant to accrue.
-- ============================================================================
