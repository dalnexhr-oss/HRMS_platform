-- ============================================================================
-- Dalnex HRMS — Row Level Security
-- ----------------------------------------------------------------------------
-- Model: this is an internal admin portal. Any authenticated staff member with
-- a profile whose role is admin/hr/manager may read/write HR data. 'viewer' is
-- read-only. Anonymous users get nothing. Privileged batch jobs (night sweep,
-- payroll compute) run with the service-role key and bypass RLS entirely.
-- ============================================================================

-- helper: role of the current user
create or replace function auth_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function is_staff() returns boolean
language sql stable as $$
  select auth_role() in ('admin','hr','manager');
$$;

create or replace function is_authenticated() returns boolean
language sql stable as $$
  select auth.uid() is not null and auth_role() is not null;
$$;

-- Enable RLS on every table.
alter table branches            enable row level security;
alter table departments         enable row level security;
alter table profiles            enable row level security;
alter table employees           enable row level security;
alter table punch_events        enable row level security;
alter table attendance_days     enable row level security;
alter table late_marks          enable row level security;
alter table holidays            enable row level security;
alter table leave_balances      enable row level security;
alter table requests            enable row level security;
alter table payroll_runs        enable row level security;
alter table payslips            enable row level security;
alter table payslip_adjustments enable row level security;
alter table pt_slabs            enable row level security;
alter table notices             enable row level security;
alter table helpdesk_tickets    enable row level security;
alter table settings            enable row level security;
alter table activity_log        enable row level security;

-- ----------------------------------------------------------------------------
-- profiles: a user can always read/update their own row; staff can read all.
-- ----------------------------------------------------------------------------
create policy profiles_self_read on profiles
  for select using (id = auth.uid() or is_staff());
create policy profiles_self_update on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on profiles
  for all using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- ----------------------------------------------------------------------------
-- Read for any authenticated staff/viewer; write for staff only.
-- Applied uniformly to the HR data tables.
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'branches','departments','employees','punch_events','attendance_days',
    'late_marks','holidays','leave_balances','requests','payroll_runs',
    'payslips','payslip_adjustments','pt_slabs','notices','helpdesk_tickets',
    'settings','activity_log'
  ]
  loop
    execute format($f$
      create policy %1$s_read on %1$s
        for select using (is_authenticated());
    $f$, t);

    execute format($f$
      create policy %1$s_write on %1$s
        for all using (is_staff()) with check (is_staff());
    $f$, t);
  end loop;
end $$;
