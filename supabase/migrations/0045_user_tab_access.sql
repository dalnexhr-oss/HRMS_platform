-- ============================================================================
-- 0045 — per-USER tab access, replacing the per-role table from 0044
--
-- 0044 keyed access by role, so every admin got the same tabs. Access is now set
-- per individual account: two admins can see different tabs. The screen is a side
-- panel on /users rather than a tab of its own.
--
-- 0044's table is dropped. It ships as its own migration rather than a rewrite of
-- 0044 because that file may already have been applied — `db push` would skip an
-- edited-in-place migration and the new table would never be created.
--
-- The rules from 0044 are unchanged:
--   * Only accounts holding 'admin' or 'hr' may be configured (trigger below).
--   * NARROWING ONLY. effective = NAV_ROLE_GATED (static, in code) AND this table.
--     Granting past the static gate would render a page whose queries then fail
--     on RLS, which knows nothing about this table. A missing row means allowed.
--   * A super admin is never configurable, so nobody can be locked out of the
--     panel that undoes the change.
-- ============================================================================

drop table if exists role_tab_access;

create table if not exists user_tab_access (
  user_id    uuid        not null references profiles(id) on delete cascade,
  slug       text        not null,
  allowed    boolean     not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid        references profiles(id) on delete set null,

  primary key (user_id, slug)
);

comment on table user_tab_access is
  'Super-admin controlled tab visibility per user account. Only admin/hr accounts may have rows. A missing row means allowed; this table can only narrow the static NAV_ROLE_GATED map, never widen it.';

-- "for the roles of admin, HR — nothing more", enforced in the database and not
-- only in the action. A cross-table rule cannot be a CHECK constraint.
create or replace function fn_guard_user_tab_access() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target_role text;
begin
  select role::text into target_role from profiles where id = new.user_id;

  if target_role is null then
    raise exception 'That account has no profile, so its tab access cannot be set.'
      using errcode = '23514';
  end if;

  if target_role not in ('admin','hr') then
    raise exception
      'Tab access can only be set for admin and HR accounts (this one is "%").', target_role
      using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists user_tab_access_role_guard on user_tab_access;
create trigger user_tab_access_role_guard
  before insert or update on user_tab_access
  for each row execute function fn_guard_user_tab_access();

alter table user_tab_access enable row level security;

-- Read: your own rows (the portal layout needs them on every request), plus a
-- super admin reading anyone's to render the panel.
drop policy if exists user_tab_access_read on user_tab_access;
create policy user_tab_access_read on user_tab_access
  for select using (user_id = auth.uid() or auth_role()::text = 'super_admin');

-- Write: super admin only.
drop policy if exists user_tab_access_write on user_tab_access;
create policy user_tab_access_write on user_tab_access
  for all
  using (auth_role()::text = 'super_admin')
  with check (auth_role()::text = 'super_admin');

create index if not exists user_tab_access_user_idx on user_tab_access (user_id);
