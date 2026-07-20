-- ============================================================================
-- Dalnex HRMS — Employee self-service auth + Company Policies
-- ----------------------------------------------------------------------------
-- Adds an 'employee' role, links a login profile to an employees row, and lets
-- HR publish company policies that employees read (and acknowledge) from their
-- own dashboard. Tightens RLS so employees see only their own records.
-- ============================================================================

-- New role for self-service logins. (Adding an enum value; not used in this
-- same transaction, which Postgres requires.)
alter type app_role add value if not exists 'employee';

-- Link a login to the employee it represents (null for staff/admin logins).
alter table profiles
  add column if not exists employee_id uuid references employees(id) on delete set null;

-- ---------------------------------------------------------------- helpers ---
-- The employees.id this login maps to (null for staff).
create or replace function current_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from public.profiles where id = auth.uid();
$$;

-- Portal (staff) users see everything; employees see only their own rows.
create or replace function is_portal() returns boolean
language sql stable as $$
  select auth_role() in ('admin','hr','manager','viewer');
$$;

-- ================================================================ policies ===
create table policies (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  category       text,
  body           text not null,
  version        integer not null default 1,
  effective_date date,
  branch_id      uuid references branches(id) on delete cascade,   -- null = all branches
  published      boolean not null default false,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index policies_published_idx on policies(published);

create trigger policies_touch before update on policies
  for each row execute function set_updated_at();

create table policy_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  policy_id       uuid not null references policies(id) on delete cascade,
  employee_id     uuid not null references employees(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique (policy_id, employee_id)
);

-- ---------------------------------------------------------------- policy RLS ---
alter table policies enable row level security;
alter table policy_acknowledgements enable row level security;

-- Staff manage all policies; everyone signed in reads the published ones.
create policy policies_portal_all on policies
  for all using (is_staff()) with check (is_staff());
create policy policies_read_published on policies
  for select using (auth.uid() is not null and (published or is_portal()));

-- Staff see all acks; an employee sees and creates only their own.
create policy acks_portal_read on policy_acknowledgements
  for select using (is_portal() or employee_id = current_employee_id());
create policy acks_employee_insert on policy_acknowledgements
  for insert with check (employee_id = current_employee_id());

-- ================================================= tighten employee-scoped RLS ===
-- Replace the blanket "any authenticated user reads everything" policies from
-- migration 0003 on sensitive tables with "portal reads all / employee reads own".
do $$
declare
  t text;
  own text;
  sensitive text[] := array[
    'employees','attendance_days','payslips','payslip_adjustments',
    'requests','leave_balances','late_marks','punch_events','activity_log'
  ];
begin
  foreach t in array sensitive loop
    execute format('drop policy if exists %1$s_read on %1$s;', t);

    -- how "my own row" is expressed on this table
    own := case t
      when 'employees'           then 'id = current_employee_id()'
      when 'payslip_adjustments' then 'id in (select id from payslips where employee_id = current_employee_id())'
      else 'employee_id = current_employee_id()'
    end;

    execute format(
      'create policy %1$s_read_portal on %1$s for select using (is_portal());', t);
    execute format(
      'create policy %1$s_read_own on %1$s for select using (%2$s);', t, own);
  end loop;
end $$;

-- Let an employee raise their own request (leave / outdoor duty) from the app.
create policy requests_employee_insert on requests
  for insert with check (employee_id = current_employee_id());

-- --------------------------------------------------------------- seed policies ---
insert into policies (title, category, body, version, effective_date, published) values
  ('Attendance & Punch Policy', 'Attendance',
   'Punch in from the mobile app on arrival and punch out when leaving. Three late marks in a calendar month convert the third into an automatic half-day. Outdoor duty / site visits must be approved in advance to punch outside the office geofence.',
   2, '2026-01-01', true),
  ('Leave Policy', 'Leave',
   'Paid leave accrues monthly and must be applied for through the app. Sudden absences without an approved leave or a punch are marked Absent. Leave balances are shown on your dashboard.',
   1, '2026-01-01', true),
  ('Code of Conduct', 'HR',
   'Treat colleagues, clients and company property with respect. Report grievances through the Helpdesk. Any harassment or misuse of company resources is subject to disciplinary action.',
   3, '2026-04-01', true),
  ('Payroll & Reimbursement', 'Payroll',
   'Salaries are processed after the monthly register locks (typically the 10th). Statutory deductions (PF, ESIC, Professional Tax) follow applicable law. Reimbursement claims must be submitted with receipts before the adjustments window closes.',
   1, '2026-01-01', true);
