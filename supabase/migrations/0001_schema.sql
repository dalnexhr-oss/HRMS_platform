-- ============================================================================
-- Dalnex HRMS — Core schema
-- Postgres / Supabase
-- ----------------------------------------------------------------------------
-- Domain: attendance capture (mobile punches) -> monthly register -> payroll
-- with Indian statutory rules (PF / ESIC / Professional Tax), two branches
-- (Pune · Maharashtra, Vadodara · Gujarat).
-- ============================================================================

create extension if not exists "pgcrypto";           -- gen_random_uuid()
create extension if not exists "btree_gist";          -- exclusion constraints on ranges

-- ============================================================================
-- ENUMS
-- ============================================================================

-- Attendance status stamps used across the register / punch log.
--   P  present            LM late mark            HD half day
--   L  leave              WO week off             OH official holiday
--   AB absent             S  site visit           T  travel / outdoor duty
create type attendance_status as enum ('P','LM','HD','L','WO','OH','AB','S','T');

create type gender_type       as enum ('Male','Female','Other');
create type employee_status   as enum ('active','on_notice','inactive');
create type indian_state      as enum ('Maharashtra','Gujarat');

create type request_type      as enum ('leave','site_visit','outdoor_duty','wfh');
create type request_status    as enum ('pending','approved','rejected','cancelled');
create type leave_type        as enum ('PL','CL','SL','LWP');   -- paid / casual / sick / loss-of-pay

create type payroll_status    as enum ('draft','in_review','locked','paid');
create type payslip_status    as enum ('draft','queued','generated','paid');

create type notice_channel    as enum ('app','whatsapp','both');
create type ticket_status     as enum ('open','in_progress','resolved','closed');
create type app_role          as enum ('admin','hr','manager','viewer');

-- ============================================================================
-- ORG STRUCTURE
-- ============================================================================

create table branches (
  id                uuid primary key default gen_random_uuid(),
  name              text        not null unique,           -- 'Pune', 'Vadodara'
  state             indian_state not null,
  address           text,
  geofence_lat      numeric(9,6),
  geofence_lng      numeric(9,6),
  geofence_radius_m integer      not null default 150,
  created_at        timestamptz  not null default now()
);

create table departments (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  branch_id  uuid references branches(id) on delete set null,
  unique (name, branch_id)
);

-- App users (HR admins etc.). Mirrors auth.users; created by a trigger below.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  role        app_role    not null default 'viewer',
  branch_id   uuid references branches(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- EMPLOYEES
-- ============================================================================

create table employees (
  id                uuid primary key default gen_random_uuid(),
  code              text        not null unique,           -- 'DN001'
  full_name         text        not null,
  branch_id         uuid        not null references branches(id) on delete restrict,
  department_id     uuid        references departments(id) on delete set null,
  designation       text,
  gender            gender_type not null,
  date_of_joining   date        not null,
  date_of_birth     date,
  whatsapp          text,
  email             text,

  -- statutory identifiers
  pan               text,
  pf_uan            text,
  esic_number       text,

  -- salary structure (monthly, INR). gross = basic_da + hra + special_allowance.
  gross_monthly     numeric(12,2) not null default 0,
  basic_da          numeric(12,2) not null default 0,
  hra               numeric(12,2) not null default 0,
  special_allowance numeric(12,2) not null default 0,

  status            employee_status not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint salary_components_sum
    check (round(basic_da + hra + special_allowance, 2) = round(gross_monthly, 2)),
  constraint pan_format
    check (pan is null or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$')
);

create index employees_branch_idx on employees(branch_id);
create index employees_status_idx on employees(status);

-- ============================================================================
-- ATTENDANCE
-- ============================================================================

-- Raw punches streamed from the mobile app (the audit source of truth).
create table punch_events (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid        not null references employees(id) on delete cascade,
  punched_at   timestamptz not null,
  kind         text        not null check (kind in ('in','out')),
  lat          numeric(9,6),
  lng          numeric(9,6),
  within_geofence boolean,
  source       text        not null default 'mobile_app',
  created_at   timestamptz not null default now()
);
create index punch_events_emp_time_idx on punch_events(employee_id, punched_at);

-- One resolved row per employee per calendar day (drives the register & payroll).
create table attendance_days (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid  not null references employees(id) on delete cascade,
  work_date       date  not null,
  status          attendance_status not null,
  punch_in        time,
  punch_out       time,
  worked_minutes  integer not null default 0,
  is_corrected    boolean not null default false,
  correction_reason text,
  corrected_by    uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index attendance_days_date_idx on attendance_days(work_date);
create index attendance_days_emp_idx  on attendance_days(employee_id, work_date);

-- Late marks (3rd mark in a month => auto half-day per the rule flags).
create table late_marks (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references employees(id) on delete cascade,
  mark_date    date not null,
  auto_half_day boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (employee_id, mark_date)
);

-- ============================================================================
-- CALENDAR / HOLIDAYS
-- ============================================================================

create table holidays (
  id          uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  name        text not null,
  -- null branch => applies to every branch
  branch_id   uuid references branches(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (holiday_date, branch_id)
);

-- ============================================================================
-- APPROVALS (leave / outdoor duty / site visits)
-- ============================================================================

create table leave_balances (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  year        integer not null,
  type        leave_type not null,
  balance     numeric(4,1) not null default 0,
  unique (employee_id, year, type)
);

create table requests (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  type          request_type   not null,
  leave_kind    leave_type,                       -- only for type = 'leave'
  start_date    date not null,
  end_date      date not null,
  days          numeric(4,1) not null default 1,
  reason        text,
  status        request_status not null default 'pending',
  balance_after numeric(4,1),
  reviewed_by   uuid references profiles(id) on delete set null,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint valid_range check (end_date >= start_date)
);
create index requests_status_idx on requests(status);
create index requests_emp_idx    on requests(employee_id);

-- ============================================================================
-- PAYROLL
-- ============================================================================

-- One run per branch-agnostic month. Lifecycle: draft -> in_review -> locked -> paid.
create table payroll_runs (
  id                 uuid primary key default gen_random_uuid(),
  period_month       date not null unique,        -- first day of the month, e.g. 2026-06-01
  status             payroll_status not null default 'draft',
  working_days       integer,
  target_minutes     integer,
  month_closed_at    timestamptz,
  drafts_computed_at timestamptz,
  adjustments_open   date,
  adjustments_close  date,
  locked_at          timestamptz,
  paid_at            timestamptz,
  created_at         timestamptz not null default now()
);

create table payslips (
  id                uuid primary key default gen_random_uuid(),
  payroll_run_id    uuid not null references payroll_runs(id) on delete cascade,
  employee_id       uuid not null references employees(id) on delete restrict,

  -- attendance-derived
  payable_days      numeric(5,1) not null default 0,
  worked_minutes    integer not null default 0,
  target_minutes    integer not null default 0,
  shortfall_minutes integer not null default 0,

  -- earnings (all INR)
  per_day_rate      numeric(12,2) not null default 0,
  basic_earned      numeric(12,2) not null default 0,
  hra_earned        numeric(12,2) not null default 0,
  special_earned    numeric(12,2) not null default 0,
  earned_gross      numeric(12,2) not null default 0,
  shortfall_amount  numeric(12,2) not null default 0,

  -- statutory deductions
  pf_employee       numeric(12,2) not null default 0,
  pf_employer       numeric(12,2) not null default 0,
  esic_employee     numeric(12,2) not null default 0,
  esic_employer     numeric(12,2) not null default 0,
  professional_tax  numeric(12,2) not null default 0,

  net_payable       numeric(12,2) not null default 0,
  status            payslip_status not null default 'draft',
  pdf_url           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (payroll_run_id, employee_id)
);
create index payslips_run_idx on payslips(payroll_run_id);

-- Manual, editable-until-lock adjustments on a payslip.
create table payslip_adjustments (
  id                  uuid primary key references payslips(id) on delete cascade,
  advance_recovery    numeric(12,2) not null default 0,
  loss_damage         numeric(12,2) not null default 0,
  last_month_balance  numeric(12,2) not null default 0,   -- +/-
  reimbursement_bonus numeric(12,2) not null default 0,
  remarks             text,
  updated_by          uuid references profiles(id) on delete set null,
  updated_at          timestamptz not null default now()
);

-- Professional-tax slabs by state/gender. Feb often carries a different amount.
create table pt_slabs (
  id          uuid primary key default gen_random_uuid(),
  state       indian_state not null,
  gender      gender_type,                         -- null => any
  min_gross   numeric(12,2) not null default 0,
  max_gross   numeric(12,2),                       -- null => no upper bound
  amount      numeric(12,2) not null,
  month       integer check (month between 1 and 12),  -- null => all months
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- COMMUNICATIONS & OPS
-- ============================================================================

create table notices (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text,
  pdf_url      text,
  channel      notice_channel not null default 'app',
  branch_id    uuid references branches(id) on delete cascade,
  published_at timestamptz,
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table helpdesk_tickets (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete set null,
  subject     text not null,
  body        text,
  category    text,
  status      ticket_status not null default 'open',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Global + branch rule flags surfaced in Settings ("every open rule is a switch").
create table settings (
  key         text primary key,                    -- 'mark_threshold', 'geofence_radius_m'...
  value       jsonb not null,
  label       text,
  description text,
  branch_id   uuid references branches(id) on delete cascade,
  updated_at  timestamptz not null default now()
);

-- Immutable-ish audit / activity feed shown on the dashboard.
create table activity_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references profiles(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  event_type  text not null,                       -- 'night_sweep','late_mark','punch_in'...
  message     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index activity_log_time_idx on activity_log(occurred_at desc);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- keep updated_at fresh
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger employees_touch      before update on employees
  for each row execute function set_updated_at();
create trigger attendance_touch     before update on attendance_days
  for each row execute function set_updated_at();
create trigger payslips_touch       before update on payslips
  for each row execute function set_updated_at();

-- auto-create a profile row when a new auth user signs up
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
