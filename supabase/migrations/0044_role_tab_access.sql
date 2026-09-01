-- ============================================================================
-- 0044 — per-role tab access, controlled by the super admin
--
-- Backs the /access screen: a super admin decides which sidebar tabs the 'admin'
-- and 'hr' roles may open. Nothing else is configurable, and that is enforced by
-- a CHECK constraint rather than only in the UI.
--
-- SEMANTICS — this table can only take access AWAY, never hand it out.
--   effective = NAV_ROLE_GATED (static, in code) AND this table
-- Granting a tab a role was never entitled to would produce a page that renders
-- and then fails every query, because RLS still gates the data underneath. So a
-- missing row means "allowed" (the default today), and a row with allowed=false
-- is the only thing that changes behaviour.
--
-- super_admin is deliberately NOT configurable: an account able to revoke its own
-- last tab could lock everyone out of /access with no way back in.
-- ============================================================================

create table if not exists role_tab_access (
  role       app_role    not null,
  slug       text        not null,
  allowed    boolean     not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid        references profiles(id) on delete set null,

  primary key (role, slug),

  -- "for the roles of admin, HR — nothing more". A super_admin row would be a
  -- lockout risk; manager/viewer/employee reach the portal through their own
  -- static gates and are not part of this feature.
  constraint role_tab_access_configurable_roles
    check (role::text in ('admin','hr'))
);

comment on table role_tab_access is
  'Super-admin controlled tab visibility for the admin and hr roles. A missing row means allowed; this table can only narrow the static NAV_ROLE_GATED map, never widen it.';

alter table role_tab_access enable row level security;

-- Read: any portal user. The map is not sensitive — it decides which links the
-- signed-in user sees, and the layout has to read it on every portal request.
drop policy if exists role_tab_access_read on role_tab_access;
create policy role_tab_access_read on role_tab_access
  for select using (is_portal());

-- Write: super admin only.
drop policy if exists role_tab_access_write on role_tab_access;
create policy role_tab_access_write on role_tab_access
  for all
  using (auth_role()::text = 'super_admin')
  with check (auth_role()::text = 'super_admin');

create index if not exists role_tab_access_role_idx on role_tab_access (role);
