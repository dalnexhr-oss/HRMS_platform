-- ============================================================================
-- 0017 — hardening from the code review
--
-- (1) profiles.avatar gets a DB CHECK so the constraint — not just the server
--     action — is the real boundary (an employee can PostgREST-update their own
--     row; RLS leaves avatar unconstrained). Shape mirrors updateAvatar().
-- (2) fn_purge_old_notices() is SECURITY DEFINER (runs as owner, bypassing RLS)
--     and CREATE FUNCTION grants EXECUTE to PUBLIC by default — so any signed-in
--     user could call it as a PostgREST RPC to delete notices. Revoke that; only
--     the cron/owner role needs it.
-- (3) The notices SELECT policy was is_authenticated(), so an employee could read
--     UNPUBLISHED drafts straight from PostgREST. Restrict reads to published
--     notices (staff/portal still see everything), mirroring policies.
-- ============================================================================

-- (1) avatar shape constraint --------------------------------------------------
alter table profiles drop constraint if exists profiles_avatar_shape;
alter table profiles add constraint profiles_avatar_shape check (
  avatar is null
  or avatar ~ '^preset:(0[1-9]|[1-4][0-9]|50)$'
  or (
    avatar ~ '^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+=*$'
    and length(avatar) <= 500000
  )
);

-- (2) lock down the purge function --------------------------------------------
revoke all on function public.fn_purge_old_notices() from public;
revoke all on function public.fn_purge_old_notices() from anon, authenticated;

-- (3) drafts are not readable by ordinary employees ---------------------------
drop policy if exists notices_read on notices;
create policy notices_read on notices
  for select using (is_portal() or published_at is not null);
