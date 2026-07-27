-- ============================================================================
-- 0033 — Attendance automation: scheduled auto punch-out + month auto-lock.
--
-- Auto punch-out and month-locking existed only as manual buttons / payroll
-- side-effects. This adds the two as SQL functions and schedules them on pg_cron
-- (0031), so an open punch is closed nightly and a finished month is sealed
-- without anyone remembering to click. Both are idempotent via cron_claim().
--
-- Month-lock uses payroll_runs.month_closed_at (already in 0001) as an
-- attendance seal independent of the payroll status; the app guard
-- (requireOpenPayrollMonth) is extended to honour it.
-- ============================================================================

-- Resolve the configured auto punch-out time (jsonb string like "18:00") to a
-- `time`, defaulting to 18:00 — mirrors getAutoPunchOutMinutes() in TS.
create or replace function fn_auto_punch_out_time()
returns time
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(( select value #>> '{}' from settings where key = 'auto_punch_out_time' ), '')::time,
    time '18:00'
  );
$$;

-- Close every open punch (punch_in set, punch_out null) for `target`, unless the
-- month is locked/paid/closed. Sets worked_minutes from the span. Writes ONE
-- activity_log summary row. Returns the number of days closed.
create or replace function fn_auto_punch_out(target date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  out_t   time := fn_auto_punch_out_time();
  closed  integer := 0;
  locked  boolean;
begin
  -- Respect a locked/paid/closed month — never rewrite attendance behind final pay.
  select (status in ('locked','paid')) or (month_closed_at is not null)
    into locked
    from payroll_runs
   where period_month = date_trunc('month', target)::date;
  if coalesce(locked, false) then
    return 0;
  end if;

  with updated as (
    update attendance_days a
       set punch_out = out_t,
           -- span in minutes, clamped at 0 (a close-time before punch-in => 0)
           worked_minutes = greatest(0, (extract(epoch from (out_t - a.punch_in)) / 60)::int),
           updated_at = now()
     where a.work_date = target
       and a.punch_in is not null
       and a.punch_out is null
    returning a.id
  )
  select count(*) into closed from updated;

  if closed > 0 then
    insert into activity_log (actor_id, employee_id, event_type, message, metadata)
    values (
      null, null, 'night_sweep',
      format('Auto punch-out closed %s open day(s) on %s at %s', closed, target, out_t),
      jsonb_build_object('work_date', target, 'closed', closed, 'out_time', out_t::text, 'source', 'pg_cron')
    );
  end if;

  return closed;
end;
$$;

-- Seal the previous calendar month: stamp month_closed_at on its payroll run so
-- attendance for that month can no longer be edited. Idempotent and harmless if
-- no run exists yet. Returns true when it sealed something this call.
create or replace function fn_auto_close_prev_month()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  prev date := (date_trunc('month', current_date) - interval '1 month')::date;
  did  integer := 0;
begin
  update payroll_runs
     set month_closed_at = now()
   where period_month = prev
     and month_closed_at is null;
  get diagnostics did = row_count;
  return did > 0;
end;
$$;

-- --- schedule the jobs (pg_cron runs in UTC) -------------------------------
-- Auto punch-out at 15:30 UTC = 21:00 IST, closing the current IST date. The
-- cron_claim guard means a manual re-run or duplicate fire does no extra work.
select cron.schedule(
  'attendance-auto-punch-out',
  '30 15 * * *',
  $cron$
    select case
      when cron_claim('auto_punch_out', ((now() at time zone 'Asia/Kolkata')::date)::text)
      then fn_auto_punch_out((now() at time zone 'Asia/Kolkata')::date)
      else 0
    end;
  $cron$
);

-- Month auto-lock: run daily at 20:00 UTC; only acts on the previous month and
-- is idempotent, so the first run after month-end seals it and the rest no-op.
select cron.schedule(
  'attendance-auto-close-month',
  '0 20 * * *',
  $cron$
    select case
      when cron_claim('auto_close_month', to_char((date_trunc('month', current_date) - interval '1 month'), 'YYYY-MM'))
      then fn_auto_close_prev_month()
      else false
    end;
  $cron$
);
