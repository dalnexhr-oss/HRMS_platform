-- ============================================================================
-- 0026 — Item Management. A stock/inventory register with an assignment log.
-- Two tables: items (stock) + item_assignments (who got how many, when). A view
-- v_items derives quantity_assigned / quantity_remaining. Admin + HR only, at the
-- app layer and via RLS. Mirrors the 0025 assets RLS shape.
-- ============================================================================

create table items (
  id             uuid primary key default gen_random_uuid(),
  item_code      text,                                   -- "Item ID" (user-facing)
  item_name      text        not null,
  category       text,
  brand          text,
  size_spec      text,                                   -- Size / Specification
  total_quantity integer     not null default 0 check (total_quantity >= 0),
  unit           text,                                   -- pcs, box, …
  returnable     boolean     not null default false,
  status         text        not null default 'In Stock',
  remarks        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table item_assignments (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid    not null references items(id) on delete cascade,
  employee_id   uuid    references employees(id) on delete set null,
  person_name   text,                                    -- snapshot at assign time
  employee_code text,                                    -- snapshot at assign time
  quantity      integer not null check (quantity > 0),
  assigned_date date    not null default current_date,
  assigned_by   text,                                    -- acting admin's name
  returned      boolean not null default false,
  returned_date date,
  remarks       text,
  created_at    timestamptz not null default now()
);
create index item_assignments_item_idx on item_assignments (item_id);

comment on table items is 'Inventory register. Admin/HR only.';
comment on table item_assignments is 'Log of item issuances to employees. Admin/HR only.';

-- Derived quantities: assigned = Σ active (not returned) qty; remaining = total − assigned.
create view v_items as
select
  i.*,
  coalesce((select sum(a.quantity) from item_assignments a
            where a.item_id = i.id and not a.returned), 0)::int as quantity_assigned,
  (i.total_quantity - coalesce((select sum(a.quantity) from item_assignments a
            where a.item_id = i.id and not a.returned), 0))::int as quantity_remaining
from items i;
-- Run as the caller so the base-table RLS below applies (0013 pattern).
alter view v_items set (security_invoker = on);

create trigger items_touch before update on items
  for each row execute function set_updated_at();

-- RLS: admin + HR only, both tables. auth_role() already has search_path pinned (0024).
alter table items            enable row level security;
alter table item_assignments enable row level security;

create policy items_admin_hr on items
  for all
  using (auth_role() in ('admin', 'hr'))
  with check (auth_role() in ('admin', 'hr'));

create policy item_assignments_admin_hr on item_assignments
  for all
  using (auth_role() in ('admin', 'hr'))
  with check (auth_role() in ('admin', 'hr'));
