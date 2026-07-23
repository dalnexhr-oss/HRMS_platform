-- ============================================================================
-- 0015 — notices auto-expire after 30 days
--
-- Notices are short-lived announcements. 30 days after publication (or creation
-- for a draft) they:
--   • disappear from the employee dashboard  — an in-app date filter (me/page)
--   • are hard-deleted from the DB            — the purge below
--
-- Two mechanisms, so it works regardless of pg_cron availability:
--   1. fn_purge_old_notices() + a daily pg_cron job (true automation).
--   2. If pg_cron isn't enabled on the project, the staff Notices page calls the
--      same delete opportunistically (queries.ts:purgeExpiredNotices), and the
--      dashboard filter keeps stale notices out of every employee's view.
--
-- Scope is deliberately ONLY the notices table — nothing else auto-deletes.
-- ============================================================================

create or replace function public.fn_purge_old_notices() returns integer
language plpgsql security definer set search_path = public as $$
declare removed integer;
begin
  delete from public.notices
  where coalesce(published_at, created_at) < now() - interval '30 days';
  get diagnostics removed = row_count;
  return removed;
end $$;

-- Schedule a daily purge. Wrapped so a project without pg_cron still applies the
-- migration cleanly (the function above + the in-app purge keep working).
do $$
begin
  create extension if not exists pg_cron;
  -- cron.schedule upserts by job name; runs daily at 02:15 UTC.
  perform cron.schedule(
    'purge-old-notices',
    '15 2 * * *',
    $c$ select public.fn_purge_old_notices(); $c$
  );
exception when others then
  raise notice
    'pg_cron unavailable (%). Notices are still filtered in-app and purged when staff open /notices; enable pg_cron to hard-delete them on a daily schedule.',
    sqlerrm;
end $$;
