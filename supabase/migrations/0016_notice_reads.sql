-- ============================================================================
-- 0016 — per-employee "notice read" receipts
--
-- Mirrors policy_acknowledgements (migration 0004): one row per (notice,
-- employee) records that the employee marked that notice as read on their
-- dashboard. ON DELETE CASCADE means a purged/expired notice takes its receipts
-- with it, so nothing is orphaned by the 30-day auto-delete (migration 0015).
-- ============================================================================
create table if not exists notice_reads (
  id          uuid primary key default gen_random_uuid(),
  notice_id   uuid not null references notices(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  read_at     timestamptz not null default now(),
  unique (notice_id, employee_id)
);

alter table notice_reads enable row level security;

-- Staff see all read receipts; an employee sees and creates only their own.
create policy notice_reads_portal_read on notice_reads
  for select using (is_portal() or employee_id = current_employee_id());
create policy notice_reads_employee_insert on notice_reads
  for insert with check (employee_id = current_employee_id());
