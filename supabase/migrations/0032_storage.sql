-- ============================================================================
-- 0032 — Private Storage buckets + RLS.
--
-- The app has never used Supabase Storage (avatars are base64 in a column).
-- These three private buckets back the roadmap's file features:
--   employee-documents     — onboarding/exit docs (offer letter, IDs, certs)
--   reimbursement-receipts — claim receipts
--   generated-documents    — system-generated PDFs (relieving/F&F/experience)
--
-- Object path convention: `<employee_id>/<uuid>-<filename>`. RLS keys off the
-- FIRST path segment (storage.foldername(name))[1] so an employee reaches only
-- their own folder; staff (admin/hr/manager) reach everything. Generated
-- documents are staff-write / owner-read (the employee never uploads there).
-- ============================================================================

-- Buckets are private (public = false): access is only ever via signed URLs
-- minted server-side after an RLS check. Idempotent upsert so re-running is safe.
insert into storage.buckets (id, name, public)
values
  ('employee-documents', 'employee-documents', false),
  ('reimbursement-receipts', 'reimbursement-receipts', false),
  ('generated-documents', 'generated-documents', false)
on conflict (id) do nothing;

-- --- employee-documents: staff full access, employee read+write own folder ---
drop policy if exists emp_docs_staff_all on storage.objects;
create policy emp_docs_staff_all on storage.objects
  for all
  using (bucket_id = 'employee-documents' and is_staff())
  with check (bucket_id = 'employee-documents' and is_staff());

drop policy if exists emp_docs_own_read on storage.objects;
create policy emp_docs_own_read on storage.objects
  for select
  using (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = current_employee_id()::text
  );

drop policy if exists emp_docs_own_write on storage.objects;
create policy emp_docs_own_write on storage.objects
  for insert
  with check (
    bucket_id = 'employee-documents'
    and (storage.foldername(name))[1] = current_employee_id()::text
  );

-- --- reimbursement-receipts: staff full access, employee read+write own -------
drop policy if exists receipts_staff_all on storage.objects;
create policy receipts_staff_all on storage.objects
  for all
  using (bucket_id = 'reimbursement-receipts' and is_staff())
  with check (bucket_id = 'reimbursement-receipts' and is_staff());

drop policy if exists receipts_own_read on storage.objects;
create policy receipts_own_read on storage.objects
  for select
  using (
    bucket_id = 'reimbursement-receipts'
    and (storage.foldername(name))[1] = current_employee_id()::text
  );

drop policy if exists receipts_own_write on storage.objects;
create policy receipts_own_write on storage.objects
  for insert
  with check (
    bucket_id = 'reimbursement-receipts'
    and (storage.foldername(name))[1] = current_employee_id()::text
  );

-- --- generated-documents: staff write, owner read-only (never employee-write) -
drop policy if exists gen_docs_staff_all on storage.objects;
create policy gen_docs_staff_all on storage.objects
  for all
  using (bucket_id = 'generated-documents' and is_staff())
  with check (bucket_id = 'generated-documents' and is_staff());

drop policy if exists gen_docs_own_read on storage.objects;
create policy gen_docs_own_read on storage.objects
  for select
  using (
    bucket_id = 'generated-documents'
    and (storage.foldername(name))[1] = current_employee_id()::text
  );
