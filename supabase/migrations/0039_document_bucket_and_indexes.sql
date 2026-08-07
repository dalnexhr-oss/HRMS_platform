-- ============================================================================
-- 0039  DOCUMENT BUCKET + HOT-PATH INDEXES
-- ----------------------------------------------------------------------------
-- Two unrelated fixes that both need DDL, kept in one file so there is a single
-- migration to apply.
--
-- §1  employee_documents.bucket
--     Documents reach this table from TWO buckets (both created in 0032):
--
--       employee-documents  — filed BY or FOR the employee (uploadEmployeeDocument).
--                             Employee has INSERT + SELECT on their own folder.
--       generated-documents — a system-issued PDF: relieving letter, experience
--                             letter, full-and-final statement (generateExitDocument).
--                             Staff write, owner reads. NEVER employee-write.
--
--     The row never recorded WHICH bucket held the object, so getDocumentUrl
--     signed every path against employee-documents. Every issued letter therefore
--     failed with "Object not found" — for the employee AND for HR. This column
--     closes that hole.
--
--     Deriving the bucket from `category` instead was considered and rejected:
--     generateExitDocument writes category 'experience', which is ALSO a genuine
--     employee-upload category (an experience letter from a previous employer).
--     No category rule can separate the two.
--
-- §2  Missing indexes on employee_id
--     Six tables on the /me dashboard's critical path filter by employee_id with
--     no supporting index. Small tables today — this is correctness-for-scale,
--     not a fix for anything currently visible.
-- ============================================================================


-- ============================================================================
-- §1  employee_documents.bucket
-- ============================================================================

-- Default is the historical assumption, so every pre-existing row keeps its
-- current (correct, for employee uploads) meaning until the backfill below
-- moves the ones that were wrong.
alter table employee_documents
  add column if not exists bucket text not null default 'employee-documents';

alter table employee_documents
  drop constraint if exists employee_documents_bucket_known;
alter table employee_documents
  add constraint employee_documents_bucket_known
    check (bucket in ('employee-documents', 'generated-documents'));

comment on column employee_documents.bucket is
  'Storage bucket holding storage_path. employee-documents = filed by/for the employee; '
  'generated-documents = system-issued PDF (0032: staff-write, owner-read).';

-- Backfill, pass 1: ask storage which bucket actually holds each object rather
-- than guessing from category. This is exact — a row is only reclassified when
-- the object is demonstrably in generated-documents.
--
-- Wrapped so that a role without read access to storage.objects degrades to
-- pass 2 instead of failing the whole migration.
do $$
begin
  update employee_documents ed
     set bucket = 'generated-documents'
   where ed.bucket = 'employee-documents'
     and exists (
       select 1
         from storage.objects o
        where o.bucket_id = 'generated-documents'
          and o.name = ed.storage_path
     );
exception
  when insufficient_privilege or undefined_table then
    raise notice '0039: storage.objects not readable here — relying on the category pass below.';
end $$;

-- Backfill, pass 2: catches anything pass 1 missed (a row whose object was
-- deleted, or the no-privilege path above). 'relieving' and 'settlement' are
-- unambiguous — neither appears in DOCUMENT_CATEGORIES, so an employee can
-- never have filed one themselves. 'experience' is deliberately NOT listed: it
-- is both an issued letter and a genuine employee upload, which is exactly why
-- category alone cannot drive this.
update employee_documents
   set bucket = 'generated-documents'
 where bucket = 'employee-documents'
   and category in ('relieving', 'settlement');


-- ============================================================================
-- §2  Hot-path indexes on employee_id
-- ----------------------------------------------------------------------------
-- `create index concurrently` cannot run inside a transaction and db push wraps
-- each file in one, so these are plain creates. The tables are small enough that
-- the brief lock is irrelevant.
-- ============================================================================

-- getMyTickets: filters employee_id, orders by created_at desc.
create index if not exists helpdesk_tickets_employee_idx
  on helpdesk_tickets (employee_id, created_at desc);

-- getMyPayslips: payslips only had payslips_run_idx (payroll_run_id) and a
-- unique (payroll_run_id, employee_id) whose LEADING column is wrong for an
-- employee-only filter.
create index if not exists payslips_employee_idx
  on payslips (employee_id);

-- getMyItems / getMyAssets: both assignment tables only indexed the item/asset
-- side, never the employee side.
create index if not exists item_assignments_employee_idx
  on item_assignments (employee_id);

create index if not exists asset_assignments_employee_idx
  on asset_assignments (employee_id);

-- getReadNoticeIds
create index if not exists notice_reads_employee_idx
  on notice_reads (employee_id);

-- getEmployeePolicies reads every ack for one employee to build the "read" set.
create index if not exists policy_acknowledgements_employee_idx
  on policy_acknowledgements (employee_id);
