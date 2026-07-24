-- ============================================================================
-- 0020 — reviewer remark on reimbursements + employee edit/withdraw of pending
--
-- Two changes, both employee-facing:
--   1. A separate `review_remark` for the approver's note when a claim is
--      rejected (the existing `remarks` is the EMPLOYEE's own note — the two
--      must never overwrite each other).
--   2. Re-grant, narrowly, what 0013 deliberately withheld: an employee may now
--      edit or withdraw their OWN claim while it is still `pending`.
--
-- SECURITY: RLS cannot restrict COLUMNS, so an employee could still POST a
-- tampered `amount`/`kms` on a pending travel claim via PostgREST. That hole is
-- closed in application code — reviewReimbursement RE-DERIVES a travel claim's
-- amount as kms × rate at APPROVAL — so nothing here lets a claim be inflated or
-- self-approved (status stays pinned to 'pending', review columns stay null).
-- ============================================================================
alter table reimbursement_claims
  add column if not exists review_remark text;

-- Employee may edit their own claim only while it is pending, and only in a way
-- that keeps it pending and unreviewed (mirrors requests_employee_cancel, 0013).
drop policy if exists reimbursements_employee_update on reimbursement_claims;
create policy reimbursements_employee_update on reimbursement_claims
  for update
  using (employee_id = current_employee_id() and status = 'pending')
  with check (
    employee_id = current_employee_id()
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
  );

-- Employee may withdraw (delete) their own pending claim.
drop policy if exists reimbursements_employee_delete on reimbursement_claims;
create policy reimbursements_employee_delete on reimbursement_claims
  for delete
  using (employee_id = current_employee_id() and status = 'pending');
