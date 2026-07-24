-- ============================================================================
-- 0022 — Aadhaar number on employees
--
-- HR add/edit-employee form gains an Aadhaar field. Stored as 12 digits with no
-- spaces (the app strips them); optional. Kept in its own migration because 0019
-- was already applied — an edited-in-place migration would never re-run.
-- ============================================================================
alter table employees
  add column if not exists aadhaar text;

-- 12 digits (or null). `add constraint` has no `if not exists`, so drop-then-add
-- keeps this idempotent — same idiom as the PAN constraint in 0001.
alter table employees drop constraint if exists employees_aadhaar_format;
alter table employees add constraint employees_aadhaar_format
  check (aadhaar is null or aadhaar ~ '^[0-9]{12}$');
