-- ============================================================================
-- 0034 — Asset lifecycle: category, transfer history, maintenance, consumables,
-- warranty reminders.
--
-- Assets (0025/0028) were a flat register with a single-holder snapshot and no
-- history, no maintenance, no category, and unused warranty dates. This adds:
--   * assets.asset_category  — classify (Desktop/Laptop/Monitor/…)
--   * items.item_type        — 'fixed' | 'consumable' (formalises returnable)
--   * asset_assignments      — full transfer history (clone of item_assignments)
--   * asset_maintenance      — service/repair log with optional next-due
--   * notification_kind 'warranty' + a daily pg_cron reminder job
--   * v_asset_summary        — counts by category / assigned / warranty-expiring
--
-- The 'warranty' enum value is added here and only USED by the cron function
-- (a later transaction) — Postgres forbids using a freshly added enum value in
-- the same transaction, same reason as 0029.
-- ============================================================================

-- --- columns ---------------------------------------------------------------
alter table assets add column if not exists asset_category text;   -- Desktop/Laptop/Monitor/…
comment on column assets.asset_category is 'Free-text asset class (Desktop, Laptop, Monitor, Printer, …).';

alter table items add column if not exists item_type text not null default 'fixed'
  check (item_type in ('fixed', 'consumable'));
comment on column items.item_type is 'fixed = returnable equipment; consumable = used up, not returned.';
-- Seed item_type from the existing returnable flag (returnable=false ≈ consumable).
update items set item_type = 'consumable' where returnable = false;

alter type notification_kind add value if not exists 'warranty';

-- --- asset_assignments (transfer history) ----------------------------------
create table if not exists asset_assignments (
  id             uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references assets(id) on delete cascade,
  employee_id    uuid references employees(id) on delete set null,
  person_name    text,                       -- snapshot at assign time
  employee_code  text,                        -- snapshot at assign time
  assigned_date  date not null default current_date,
  assigned_by    text,                        -- acting admin's name
  returned       boolean not null default false,
  returned_date  date,
  remarks        text,
  created_at     timestamptz not null default now()
);
create index if not exists asset_assignments_asset_idx on asset_assignments (asset_id, assigned_date desc);
comment on table asset_assignments is 'Full assign/return history for assets (the single-holder snapshot on assets is the CURRENT holder; this is the trail).';

alter table asset_assignments enable row level security;
drop policy if exists asset_assignments_admin_hr on asset_assignments;
create policy asset_assignments_admin_hr on asset_assignments
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));
drop policy if exists asset_assignments_read_own on asset_assignments;
create policy asset_assignments_read_own on asset_assignments
  for select using (employee_id = current_employee_id());

-- --- asset_maintenance -----------------------------------------------------
create table if not exists asset_maintenance (
  id           uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references assets(id) on delete cascade,
  maint_date   date not null default current_date,
  maint_type   text,                          -- 'service' | 'repair' | 'upgrade' | …
  cost         numeric(12,2),
  vendor       text,
  notes        text,
  next_due     date,                          -- optional next service date
  created_at   timestamptz not null default now(),
  created_by   text
);
create index if not exists asset_maintenance_asset_idx on asset_maintenance (asset_id, maint_date desc);
comment on table asset_maintenance is 'Service/repair/upgrade log per asset. Admin/HR only.';

alter table asset_maintenance enable row level security;
drop policy if exists asset_maintenance_admin_hr on asset_maintenance;
create policy asset_maintenance_admin_hr on asset_maintenance
  for all using (auth_role() in ('admin','hr')) with check (auth_role() in ('admin','hr'));

-- --- v_asset_summary (stock summary) ---------------------------------------
create or replace view v_asset_summary as
  select
    coalesce(asset_category, 'Uncategorised')                 as category,
    count(*)                                                  as total,
    count(*) filter (where assigned_employee_id is not null)  as assigned,
    count(*) filter (where assigned_employee_id is null)      as available,
    count(*) filter (where warranty_upto is not null
                       and warranty_upto <= current_date + 30) as warranty_expiring
  from assets
  group by 1
  order by 1;
comment on view v_asset_summary is 'Asset counts by category with assigned/available and warranty-expiring (≤30d).';

-- --- warranty reminders (pg_cron) ------------------------------------------
-- Notify every admin/HR profile about assets whose warranty expires within 30
-- days. Idempotent per (asset, warranty_upto) via cron_claim, so an asset is
-- flagged once per warranty date, not daily.
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
       where p.role in ('admin','hr');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

select cron.schedule(
  'asset-warranty-reminders',
  '0 3 * * *',   -- 03:00 UTC = 08:30 IST daily
  $cron$ select fn_warranty_reminders(); $cron$
);
