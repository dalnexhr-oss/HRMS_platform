-- ============================================================================
-- 0046 — 'manager' becomes an employee-level role
--
-- Manager was a staff role: it landed on /today and could READ every portal
-- table. Its write access was withdrawn earlier at the app layer (_guard.ts
-- WRITE_ROLES), which left it half-privileged — no writes, but full read of
-- payroll, salaries and everyone's attendance. Manager now has the same access
-- as an employee: their own record and nothing else.
--
-- The app already routes them to /me (STAFF_ROLES in lib/auth.ts). This migration
-- makes RLS agree, because the UI is not the boundary: without it a manager could
-- still read every portal table straight over the REST API with their own token.
--
-- Nothing new is granted. The employee policies (0004) key on
-- current_employee_id(), NOT on the literal role 'employee', so a manager whose
-- profile carries an employee_id is treated exactly like an employee the moment
-- these two helpers stop listing them.
--
-- NOTE: a manager whose profile has employee_id = null now sees nothing at all.
-- That is the same state an unlinked employee login has always been in. Link the
-- account from /users → the row's employee picker.
-- ============================================================================

-- Write tier. Manager drops out; this matches _guard.ts WRITE_ROLES exactly, so
-- the app layer and RLS finally agree instead of the app being the narrower one.
create or replace function is_staff() returns boolean
language sql stable as $$
  select auth_role()::text in ('super_admin','admin','hr');
$$;

-- Read tier for staff screens. 'viewer' stays: it is the read-only portal role.
create or replace function is_portal() returns boolean
language sql stable as $$
  select auth_role()::text in ('super_admin','admin','hr','viewer');
$$;

comment on function is_staff() is
  'Portal WRITE tier: super_admin, admin, hr. Mirrors _guard.ts WRITE_ROLES.';
comment on function is_portal() is
  'Portal READ tier: super_admin, admin, hr, viewer. Manager is employee-level (0046).';
