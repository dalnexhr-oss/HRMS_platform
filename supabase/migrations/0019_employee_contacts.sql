-- ============================================================================
-- 0019 — official / personal contact fields on employees
--
-- The roster carried a single `whatsapp` number (kept as-is) and an unused
-- `email` column. HR asked to record BOTH an official and a personal mobile
-- number and email id per employee, so add four nullable text columns. No
-- format constraints — Indian numbers, extensions and secondary domains vary.
-- ============================================================================
alter table employees
  add column if not exists mobile_official text,
  add column if not exists mobile_personal text,
  add column if not exists email_official  text,
  add column if not exists email_personal  text;
