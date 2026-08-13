-- ============================================================================
-- 0042 — Separate Bonus adjustment + notice PDF attachments.
--
-- §1  payslip_adjustments.bonus — a dedicated bonus line, distinct from
--     reimbursement_bonus (which stays and now reads as plain reimbursement).
--     fn_compute_payslip is re-issued (0041 body) to add it to the net.
-- §2  a private `notice-attachments` storage bucket every signed-in user may
--     read and only staff may write — a published notice can carry a PDF.
--     The path is stored in the notices.pdf_url column, which has existed
--     (unused) since 0001, so no table change is needed.
-- ============================================================================


-- ============================================================== §1 payslip ---
alter table payslip_adjustments
  add column if not exists bonus numeric(12,2) not null default 0;

comment on column payslip_adjustments.bonus is
  'Dedicated bonus payout for the month, added to net_payable. Separate from reimbursement_bonus (reimbursements).';

-- Re-issue fn_compute_payslip (0041 body) with the bonus in the net.
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
  v_reimb      numeric := 0;
  v_other      numeric := 0;
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
           coalesce(other_deductions, 0), coalesce(bonus, 0)
      into v_adv, v_loss, v_lmb, v_reimb, v_other, v_bonus
      from payslip_adjustments
     where id = v_slip_id;
  end if;

  v_net := round(
      v_earned - v_shortfall - v_pf - v_esic - v_pt
      - coalesce(v_adv, 0) - coalesce(v_loss, 0) - coalesce(v_other, 0)
      + coalesce(v_lmb, 0) + coalesce(v_reimb, 0) + coalesce(v_bonus, 0)
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
  'and adds last_month_balance, reimbursement_bonus and bonus from payslip_adjustments. '
  'See 0007/0041/0042.';


-- ================================================= §2 notice attachments ---
comment on column notices.pdf_url is
  'Storage path of the notice''s PDF in the notice-attachments bucket (0042). Unused before 0042.';

insert into storage.buckets (id, name, public)
values ('notice-attachments', 'notice-attachments', false)
on conflict (id) do nothing;

-- Staff manage attachment objects; every signed-in user may read them — a
-- published notice is company-wide, so its PDF must be too. (The bucket stays
-- private: reads still go through short-lived signed URLs.)
drop policy if exists notice_attach_staff_all on storage.objects;
create policy notice_attach_staff_all on storage.objects
  for all to authenticated
  using (bucket_id = 'notice-attachments' and is_staff())
  with check (bucket_id = 'notice-attachments' and is_staff());

drop policy if exists notice_attach_read on storage.objects;
create policy notice_attach_read on storage.objects
  for select to authenticated
  using (bucket_id = 'notice-attachments');
