-- ============================================================================
-- 0031 — Scheduling foundation (pg_cron).
--
-- The app has never had a scheduler: the night attendance sweep, comp-off
-- expiry, warranty reminders and month auto-lock were all manual (or absent).
-- This enables pg_cron so later migrations can register jobs, plus a small
-- run-ledger every job stamps so re-fires are idempotent (a job that already
-- ran for a given key/day does no work and sends no duplicate notification).
--
-- pg_cron is a Supabase-managed extension; it lives in the `cron` schema and
-- only the postgres/owner role may schedule. Jobs added here call SQL functions
-- defined in the phase migrations (0033/0034/0036). Jobs that need to run
-- TypeScript (the night sweep) are triggered over HTTP via pg_net from those
-- migrations; pg_net is enabled here too so it is available when needed.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotency ledger. Each scheduled job inserts one row per logical unit of
-- work it completes (e.g. 'compoff_expiry|2026-07-27'); a unique key means a
-- second run for the same key is a no-op. Kept tiny and append-only.
create table if not exists cron_run_log (
  id         uuid primary key default gen_random_uuid(),
  job        text        not null,               -- job name, e.g. 'compoff_expiry'
  run_key    text        not null,               -- dedupe key, e.g. the date or entity id
  detail     text,                               -- human note (counts, etc.)
  ran_at     timestamptz not null default now(),
  unique (job, run_key)
);

comment on table cron_run_log is
  'Idempotency ledger for pg_cron jobs. A job skips work whose (job, run_key) already exists.';

-- Helper: returns true and records the run the FIRST time it is called for a
-- (job, run_key); returns false on any repeat, so callers guard side-effects
-- with `if cron_claim('job', key) then ... end if;`.
create or replace function cron_claim(p_job text, p_key text, p_detail text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into cron_run_log (job, run_key, detail) values (p_job, p_key, p_detail);
  return true;
exception when unique_violation then
  return false;
end;
$$;

-- Read-only: staff may inspect the ledger; no one writes it directly (functions
-- are security-definer). RLS on for least surprise.
alter table cron_run_log enable row level security;
drop policy if exists cron_run_log_staff_read on cron_run_log;
create policy cron_run_log_staff_read on cron_run_log
  for select using (is_staff());
