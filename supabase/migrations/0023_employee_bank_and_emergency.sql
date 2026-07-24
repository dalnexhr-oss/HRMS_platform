-- ============================================================================
-- 0023 — Bank details + emergency contact on employees
--
-- HR add/edit-employee form gains two optional groups, mirroring the Aadhaar
-- field added in 0022:
--   * bank details    — bank name, account number, IFSC (for salary payment)
--   * emergency contact — name, relationship, phone
-- All nullable. Kept in its own migration because earlier ones were already
-- applied — an edited-in-place migration would never re-run.
-- ============================================================================
alter table employees
  add column if not exists bank_name                 text,
  add column if not exists bank_account_number       text,
  add column if not exists bank_ifsc                  text,
  add column if not exists emergency_contact_name     text,
  add column if not exists emergency_contact_relation text,
  add column if not exists emergency_contact_phone    text;

-- IFSC is 11 chars: 4 letters, a literal 0, then 6 alphanumerics — stored
-- upper-cased by the app. `add constraint` has no `if not exists`, so
-- drop-then-add keeps this idempotent (same idiom as the PAN/Aadhaar checks).
alter table employees drop constraint if exists employees_bank_ifsc_format;
alter table employees add constraint employees_bank_ifsc_format
  check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$');
