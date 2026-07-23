-- ============================================================================
-- 0014 — profile avatar
--
-- Adds a single `avatar` text column to profiles. It holds ONE of:
--   * NULL                      → fall back to the name's initials
--   * 'preset:<id>'             → one of the built-in Lucide avatar marks
--   * 'data:image/jpeg;base64,…'→ a small (128×128) uploaded photo, resized
--                                 client-side so it stays a few KB and needs no
--                                 Storage bucket.
--
-- No new RLS policy is required: profiles already carries `profiles_self_update`
-- (for update using id = auth.uid()), so a signed-in user may write their own
-- avatar, and staff/admin policies continue to apply unchanged.
-- ============================================================================
alter table profiles
  add column if not exists avatar text;
