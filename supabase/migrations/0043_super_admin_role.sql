-- ============================================================================
-- 0043 — the super_admin role
--
-- The app already ships a 'super_admin' AppRole (types/app.ts) and gates 20+
-- screens and actions on it, but the DATABASE never knew the value existed:
--   * app_role (0001/0004) was ('admin','hr','manager','viewer','employee'), so
--     writing role='super_admin' failed outright with 22P02.
--   * is_staff() (0003) and is_portal() (0004) did not list it, so even with the
--     enum value every RLS policy would deny a super admin — empty screens and a
--     failed write on every button.
-- This migration makes the role real, then teaches the three tiers about it.
--
-- Every role test below compares auth_role()::text, NOT the enum literal. That
-- is deliberate: Postgres refuses to *use* an enum value added by ALTER TYPE in
-- the same transaction, and `supabase db push` runs this file as one. Casting to
-- text sidesteps that entirely, so the enum add and the policy rewrites can ship
-- together instead of forcing a two-step apply.
-- ============================================================================

alter type app_role add value if not exists 'super_admin';

-- ------------------------------------------------------------- role tiers ---
-- Write tier. manager is retained here on purpose: the APP layer (_guard.ts
-- WRITE_ROLES) is now narrower than this and stops managers before a request
-- reaches RLS. Narrowing is_staff() as well would also strip manager READ access
-- through profiles_self_read, which is a separate decision.
create or replace function is_staff() returns boolean
language sql stable as $$
  select auth_role()::text in ('super_admin','admin','hr','manager');
$$;

-- Read tier for staff screens.
create or replace function is_portal() returns boolean
language sql stable as $$
  select auth_role()::text in ('super_admin','admin','hr','manager','viewer');
$$;

-- Admin tier — user administration and privileged column changes.
create or replace function is_admin() returns boolean
language sql stable as $$
  select auth_role()::text in ('super_admin','admin');
$$;

-- Admin+HR tier — assets, inventory and the onboarding/exit lifecycle tables.
create or replace function is_admin_hr() returns boolean
language sql stable as $$
  select auth_role()::text in ('super_admin','admin','hr');
$$;

comment on function is_admin() is
  'True for super_admin and admin - the user-administration tier.';
comment on function is_admin_hr() is
  'True for super_admin, admin and hr - the tier that owns assets, inventory and the employee lifecycle.';

-- --------------------------------------------------------------- profiles ---
-- 0003 gated this on auth_role() = 'admin', which locked a super admin out of
-- the very screen (/users) they are meant to own.
drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

-- The 0013 trigger that protects role/employee_id/branch_id. Body is unchanged
-- apart from the admin test, which now accepts a super admin.
create or replace function fn_guard_profile_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- The service-role client has no JWT, so auth.uid() is null there: that is the
  -- legitimate administrative path (users.ts) and is allowed through.
  if auth.uid() is null then
    return new;
  end if;

  if (new.role is distinct from old.role)
     or (new.employee_id is distinct from old.employee_id)
     or (new.branch_id is distinct from old.branch_id)
  then
    if coalesce(is_admin(), false) then
      return new;   -- a real admin (or super admin) may re-assign roles
    end if;
    raise exception
      'Not permitted: role, employee_id and branch_id can only be changed by an administrator.'
      using errcode = '42501';
  end if;

  return new;
end $$;

-- ------------------------------------------- assets / items (0025 · 0026) ---
drop policy if exists assets_admin_hr on assets;
create policy assets_admin_hr on assets
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists items_admin_hr on items;
create policy items_admin_hr on items
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists item_assignments_admin_hr on item_assignments;
create policy item_assignments_admin_hr on item_assignments
  for all using (is_admin_hr()) with check (is_admin_hr());

-- ---------------------------------------------- asset lifecycle (0034) ------
drop policy if exists asset_assignments_admin_hr on asset_assignments;
create policy asset_assignments_admin_hr on asset_assignments
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists asset_maintenance_admin_hr on asset_maintenance;
create policy asset_maintenance_admin_hr on asset_maintenance
  for all using (is_admin_hr()) with check (is_admin_hr());

-- ------------------------------ onboarding / exit lifecycle (0037) ---------
drop policy if exists employee_documents_admin_hr on employee_documents;
create policy employee_documents_admin_hr on employee_documents
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists onboarding_templates_admin_hr on onboarding_templates;
create policy onboarding_templates_admin_hr on onboarding_templates
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists onboarding_template_items_admin_hr on onboarding_template_items;
create policy onboarding_template_items_admin_hr on onboarding_template_items
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists onboarding_tasks_admin_hr on onboarding_tasks;
create policy onboarding_tasks_admin_hr on onboarding_tasks
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists acknowledgements_staff_read on acknowledgements;
create policy acknowledgements_staff_read on acknowledgements
  for select using (is_admin_hr());

drop policy if exists exit_cases_admin_hr on exit_cases;
create policy exit_cases_admin_hr on exit_cases
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists exit_clearance_items_admin_hr on exit_clearance_items;
create policy exit_clearance_items_admin_hr on exit_clearance_items
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists exit_interviews_admin_hr on exit_interviews;
create policy exit_interviews_admin_hr on exit_interviews
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists knowledge_transfer_items_admin_hr on knowledge_transfer_items;
create policy knowledge_transfer_items_admin_hr on knowledge_transfer_items
  for all using (is_admin_hr()) with check (is_admin_hr());

drop policy if exists full_and_final_admin_hr on full_and_final;
create policy full_and_final_admin_hr on full_and_final
  for all using (is_admin_hr()) with check (is_admin_hr());

-- --------------------------------------------- cron notification fan-out ---
-- Both jobs addressed "where p.role in ('admin','hr')", so a super admin was
-- silently left off every warranty and lifecycle alert. Bodies are otherwise
-- identical to 0034 / 0037.
create or replace function fn_warranty_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a       record;
  n       integer := 0;
begin
  for a in
    select id, desktop_name, warranty_upto
      from assets
     where warranty_upto is not null
       and warranty_upto between current_date and current_date + 30
  loop
    if cron_claim('warranty_reminder', a.id::text || '|' || a.warranty_upto::text) then
      insert into notifications (recipient_id, kind, title, body, link)
      select p.id, 'warranty',
             'Asset warranty expiring soon',
             format('%s — warranty ends %s', a.desktop_name, a.warranty_upto),
             '/assets'
        from profiles p
       where p.role::text in ('super_admin','admin','hr');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

create or replace function fn_lifecycle_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r  record;
  n  integer := 0;
begin
  -- (a) exits due within a week (or overdue) with clearance still open
  for r in
    select v.exit_case_id,
           v.last_working_day,
           e.full_name,
           e.code,
           (v.assets_outstanding + v.items_outstanding + v.clearance_items_open) as pending
      from v_exit_clearance_pending v
      join employees e on e.id = v.employee_id
     where v.stage <> 'completed'
       and v.last_working_day is not null
       and v.last_working_day <= current_date + 7
       and not v.clearance_complete
  loop
    if cron_claim('exit_clearance_reminder', r.exit_case_id::text || '|' || r.last_working_day::text) then
      insert into notifications (recipient_id, kind, title, body, link)
      select p.id, 'system',
             'Exit clearance still pending',
             format('%s (%s) leaves on %s with %s item(s) not cleared.',
                    r.full_name, r.code, r.last_working_day, r.pending),
             '/employees'
        from profiles p
       where p.role::text in ('super_admin','admin','hr');
      n := n + 1;
    end if;
  end loop;

  -- (b) overdue onboarding tasks (pending OR blocked — anything not done)
  for r in
    select t.id, t.title, t.due_date, e.full_name, e.code
      from onboarding_tasks t
      join employees e on e.id = t.employee_id
     where t.status <> 'done'
       and t.due_date is not null
       and t.due_date < current_date
  loop
    if cron_claim('onboarding_task_overdue', r.id::text || '|' || r.due_date::text) then
      insert into notifications (recipient_id, kind, title, body, link)
      select p.id, 'system',
             'Onboarding task overdue',
             format('"%s" was due %s for %s (%s).',
                    r.title, r.due_date, r.full_name, r.code),
             '/employees'
        from profiles p
       where p.role::text in ('super_admin','admin','hr');
      n := n + 1;
    end if;
  end loop;

  return n;
end;
$$;

comment on function fn_lifecycle_reminders() is
  'Daily nag for exits due (or overdue) within 7 days whose clearance is still open, and for onboarding tasks past due and not done. Idempotent via cron_claim.';
