-- ============================================================================
-- 0008 — Auth hardening: stop new logins from self-registering as staff.
--
-- Before this migration, profiles.role defaulted to 'viewer' (a read-only PORTAL
-- role) and handle_new_user() inserted a profile for every new auth.users row.
-- Combined with the (now removed) open GitHub OAuth button, that let ANY account
-- sign in and land in the staff portal (/today) with read access to all
-- employees, payslips, attendance and PII.
--
-- Fix: the default for a self-created profile is now 'employee' — a non-portal
-- role that lands on /me and, with employee_id null, can do nothing until an
-- admin links it. 'viewer' remains a valid role, but it is only ever assigned
-- DELIBERATELY by an admin, never handed out automatically. The app layer
-- (middleware.ts, actions/auth.ts) mirrors this: a missing profile is treated as
-- no-access, never as staff.
--
-- 'employee' was added to the app_role enum in 0004, so it is available here.
-- ============================================================================

-- New self-created profiles default to the non-portal 'employee' role.
alter table profiles alter column role set default 'employee';

-- Make the trigger explicit rather than relying only on the column default, so
-- the intent is obvious at the callsite and a future default change can't
-- silently re-open this hole.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'employee'
  )
  on conflict (id) do nothing;
  return new;
end $$;
