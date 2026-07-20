-- ============================================================================
-- Dalnex HRMS — Views & statutory payroll functions
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Monthly attendance summary per employee (feeds the register summary column).
-- ----------------------------------------------------------------------------
create or replace view v_monthly_attendance_summary as
select
  a.employee_id,
  date_trunc('month', a.work_date)::date              as period_month,
  count(*) filter (where a.status = 'P')              as present,
  count(*) filter (where a.status = 'LM')             as late_marks,
  count(*) filter (where a.status = 'HD')             as half_days,
  count(*) filter (where a.status = 'L')              as leaves,
  count(*) filter (where a.status = 'WO')             as week_offs,
  count(*) filter (where a.status = 'OH')             as holidays,
  count(*) filter (where a.status = 'AB')             as absents,
  count(*) filter (where a.status in ('S','T'))       as field_days,
  -- working days = full presence equivalents; half-days count as 0.5
  (count(*) filter (where a.status in ('P','LM','S','T')))
     + 0.5 * count(*) filter (where a.status = 'HD')  as working_days,
  sum(a.worked_minutes)                               as worked_minutes
from attendance_days a
group by a.employee_id, date_trunc('month', a.work_date);

-- ----------------------------------------------------------------------------
-- Today's dashboard headcount / present / absent.
-- ----------------------------------------------------------------------------
create or replace view v_today_board as
select
  b.name                                              as branch,
  count(*) filter (where e.status = 'active')         as headcount,
  count(a.id) filter (where a.status in ('P','LM'))   as present,
  count(a.id) filter (where a.status in ('S','T'))    as field,
  count(a.id) filter (where a.status = 'AB')          as absent
from employees e
join branches b on b.id = e.branch_id
left join attendance_days a
  on a.employee_id = e.id and a.work_date = current_date
where e.status = 'active'
group by b.name;

-- ----------------------------------------------------------------------------
-- Celebrations (birthdays / work anniversaries) for a given day.
-- ----------------------------------------------------------------------------
create or replace view v_celebrations as
select
  e.id, e.full_name, e.code, b.name as branch, d.name as department,
  'birthday'::text as kind,
  0 as years
from employees e
join branches b on b.id = e.branch_id
left join departments d on d.id = e.department_id
where e.status = 'active'
  and extract(month from e.date_of_birth) = extract(month from current_date)
  and extract(day   from e.date_of_birth) = extract(day   from current_date)
union all
select
  e.id, e.full_name, e.code, b.name, d.name,
  'anniversary'::text,
  (extract(year from age(current_date, e.date_of_joining)))::int as years
from employees e
join branches b on b.id = e.branch_id
left join departments d on d.id = e.department_id
where e.status = 'active'
  and extract(month from e.date_of_joining) = extract(month from current_date)
  and extract(day   from e.date_of_joining) = extract(day   from current_date)
  and e.date_of_joining < current_date;

-- ----------------------------------------------------------------------------
-- Professional tax resolver: pick the slab matching state/gross/gender/month.
-- ----------------------------------------------------------------------------
create or replace function fn_professional_tax(
  p_state  indian_state,
  p_gross  numeric,
  p_gender gender_type,
  p_month  integer
) returns numeric
language sql stable as $$
  select coalesce((
    select s.amount
    from pt_slabs s
    where s.state = p_state
      and (s.gender is null or s.gender = p_gender)
      and p_gross >= s.min_gross
      and (s.max_gross is null or p_gross <= s.max_gross)
      and (s.month is null or s.month = p_month)
    order by (s.month is not null) desc,   -- month-specific slab wins
             (s.gender is not null) desc,
             s.min_gross desc
    limit 1
  ), 0);
$$;

-- ----------------------------------------------------------------------------
-- Compute a single payslip from the employee's salary structure + attendance.
-- Statutory rules (confirmed in the prototype):
--   PF   = 12% of earned Basic+DA (at actual)
--   ESIC = 0.75% of earned gross, only when gross <= 21,000 cap
--   PT   = state slab (Gujarat: nil <= 12,000 else 200; Maharashtra: 200, Feb 300)
-- ----------------------------------------------------------------------------
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
  v_present    numeric;
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
  esic_cap     numeric := 21000;
  days_in_mo   int;
begin
  select * into e from employees where id = p_employee_id;
  select * into run from payroll_runs where id = p_run_id;
  select state into st from branches where id = e.branch_id;
  v_month := extract(month from run.period_month);
  days_in_mo := extract(day from (date_trunc('month', run.period_month) + interval '1 month - 1 day'));

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
    v_shortfall := round(v_perday / (8*60) * v_short_min, 0);
  end if;

  -- PF: 12% of earned Basic+DA
  v_pf := round(v_basic_e * 0.12, 0);

  -- ESIC: only if monthly gross within cap
  if e.gross_monthly <= esic_cap then
    v_esic    := round(v_earned * 0.0075, 0);
    v_esic_er := round(v_earned * 0.0325, 0);
  end if;

  -- Professional tax
  v_pt := fn_professional_tax(st, e.gross_monthly, e.gender, v_month);

  v_net := round(v_earned - v_shortfall - v_pf - v_esic - v_pt, 0);

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

-- Compute drafts for every active employee in a run.
create or replace function fn_compute_run(p_run_id uuid)
returns void language plpgsql as $$
declare r record;
begin
  for r in select id from employees where status = 'active' loop
    perform fn_compute_payslip(r.id, p_run_id);
  end loop;
  update payroll_runs
     set drafts_computed_at = now(),
         status = case when status = 'draft' then 'in_review' else status end
   where id = p_run_id;
end $$;
