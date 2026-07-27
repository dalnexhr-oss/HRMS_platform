-- ============================================================================
-- 0028 — assign assets to employees + let employees read their own equipment
--
-- Assets (0025) had no employee link. Add a single-holder assignment (a unit is
-- held by one person at a time; "return" clears it — no history table, far
-- lighter than item_assignments). Then grant employees SELECT on just their own
-- assigned assets and their own item assignments, so /me can show them.
-- ============================================================================
alter table assets
  add column if not exists assigned_employee_id  uuid references employees(id) on delete set null,
  add column if not exists assigned_person_name  text,   -- snapshot at assign time
  add column if not exists assigned_employee_code text,   -- snapshot at assign time
  add column if not exists assigned_date          date,
  add column if not exists assigned_by            text;   -- acting admin's name

-- Employee may read the asset currently assigned to them (additive to the
-- admin/HR `FOR ALL` policy from 0025). current_employee_id() is null for staff,
-- so `= null` matches nothing — no leakage.
drop policy if exists assets_read_own on assets;
create policy assets_read_own on assets
  for select using (assigned_employee_id = current_employee_id());

-- Employee may read their own item-issuance rows (additive to item_assignments'
-- admin/HR policy from 0026).
drop policy if exists item_assignments_read_own on item_assignments;
create policy item_assignments_read_own on item_assignments
  for select using (employee_id = current_employee_id());

-- ...and the item rows they've been issued, so the nested item_name/category
-- read on the employee's dashboard resolves.
drop policy if exists items_read_assigned on items;
create policy items_read_assigned on items
  for select using (
    exists (
      select 1 from item_assignments a
      where a.item_id = items.id and a.employee_id = current_employee_id()
    )
  );
