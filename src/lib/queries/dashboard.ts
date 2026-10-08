import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { fail, numberOrNull, iso } from '@/lib/queries/shared';
import { localParts, summarizePunches } from '@/lib/punch-day';
import { clockToMinutes } from '@/lib/attendance-rules';
import { trimTime } from '@/lib/display-formatting';
import { scoped } from '@/lib/db/scoped-repository';
import { collections } from '@/lib/db/collection-registry';
import { todayISO } from '@/lib/business-dates';
import { isMongoConfigured } from '@/lib/db/mongodb-connection';
import type { TodayKpis, PunchLogRow, Celebration } from '@/types/domain';
import type { DayEvent } from '@/lib/punch-day';
import type { TopbarStats } from '@/lib/portal-navigation';

/** minutes -> '3h 23m' (the punch log's "active" column). */
function hoursMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** timestamptz -> '11:00 PM' in the business timezone. */
function clockTime(ts: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(ts));
}

// today board
/** Today's headcount / attendance KPIs, aggregated from v_today_board. */
async function getTodayBoard(): Promise<TodayKpis> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('v_today_board')
    .select('branch, headcount, present, field, absent')
    .order('branch');
  if (error) {
    fail('getTodayBoard: could not load the today board', error);
  }

  const rows = data ?? [];
  const sum = (k: string) => rows.reduce((a: number, r: any) => a + Number(r[k] ?? 0), 0);
  // The view's `present` counts P/LM (in office); field duty (S/T) is separate.
  // "Present today" is everyone accounted for at work = in office + on field.
  const inOffice = sum('present');
  const field = sum('field');
  return {
    headcount: sum('headcount'),
    present: inOffice + field,
    inOffice,
    field,
    absent: sum('absent'),
    byBranch: rows.map((r: any) => ({ branch: r.branch, count: Number(r.headcount ?? 0) })),
  };
}

// punch log
/** Today's punch log, earliest punch first. */
async function getPunchLogToday(): Promise<PunchLogRow[]> {
  const dbc = await createClient();
  const now = new Date();
  const { date, time } = localParts(now);
  const [days, punches] = await Promise.all([
    dbc
      .from('attendance_days')
      .select(
        'employee_id, status, punch_in, punch_out, worked_minutes, is_corrected, auto_close_source, employees(code, full_name, branches(name))',
      )
      .eq('work_date', date),
    dbc
      .from('punch_events')
      .select<Array<DayEvent & { employee_id: string }>>('employee_id, kind, punched_at')
      .gte('punched_at', new Date(`${date}T00:00:00+05:30`))
      .lte('punched_at', now)
      .order('punched_at', { ascending: true }),
  ]);
  if (days.error) {
    fail("getPunchLogToday: could not load today's attendance", days.error);
  }
  if (punches.error) {
    fail("getPunchLogToday: could not load today's punch sessions", punches.error);
  }

  const eventsByEmployee = new Map<string, DayEvent[]>();
  for (const event of punches.data ?? []) {
    const events = eventsByEmployee.get(event.employee_id) ?? [];
    events.push(event);
    eventsByEmployee.set(event.employee_id, events);
  }
  const nowMinutes = clockToMinutes(time) ?? 0;

  return (days.data ?? [])
    .map((d: any): PunchLogRow => {
      const punchIn = trimTime(d.punch_in);
      const punchOut = trimTime(d.punch_out);
      let minutes = Math.max(0, numberOrNull(d.worked_minutes) ?? 0);
      const finalized = !!(d.is_corrected || d.auto_close_source);
      const events = eventsByEmployee.get(d.employee_id) ?? [];

      if (!finalized && events.length > 0) {
        // Completed sessions plus the current session; first-in would also count lunch breaks.
        // Use the same session pairing and minute rounding as web/device attendance writes.
        const summary = summarizePunches(events);
        const openMinute = clockToMinutes(summary.openIn);
        minutes = summary.workedMinutes;
        if (openMinute !== null) {
          minutes += Math.max(0, nowMinutes - openMinute);
        }
      } else if (!finalized && minutes === 0 && punchIn && !punchOut) {
        // Imported attendance may have no raw events. Retain its single-session fallback.
        const openMinute = clockToMinutes(punchIn);
        minutes = openMinute === null ? 0 : Math.max(0, nowMinutes - openMinute);
      }
      const active = punchIn || minutes > 0 ? hoursMinutes(minutes) : null;
      return {
        code: d.employees?.code ?? '',
        name: d.employees?.full_name ?? '',
        branch: d.employees?.branches?.name ?? '',
        in: punchIn,
        out: punchOut,
        active,
        status: d.status,
      };
    })
    .sort((a, b) => (a.in ?? '99:99').localeCompare(b.in ?? '99:99'));
}

// celebrations
/** Today's birthdays and work anniversaries, from v_celebrations. */
async function getCelebrationsToday(): Promise<Celebration[]> {
  const dbc = await createClient();
  const { data, error } = await dbc
    .from('v_celebrations')
    .select('id, full_name, branch, department, kind, years');
  if (error) {
    fail('getCelebrationsToday: could not load celebrations', error);
  }

  return (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.full_name,
    branch: c.branch,
    department: c.department,
    kind: c.kind,
    years: Number(c.years ?? 0),
  }));
}

// activity
interface ActivityRow {
  id: string;
  when: string;
  message: string;
}

/** The dashboard activity feed, newest first. */
async function getActivityFeed(limit = 20): Promise<ActivityRow[]> {
  const log = await scoped(collections.activityLog);
  const rows = await log.find(
    {},
    { projection: { message: 1, occurred_at: 1 }, sort: { occurred_at: -1 }, limit },
  );
  return rows.map((a) => ({
    id: a._id as string,
    when: clockTime(iso(a.occurred_at)),
    message: a.message as string,
  }));
}

// App settings.
// topbar
// '23:00' (or a JSON-quoted "23:00") -> '11:00 PM'. Null when unparseable.
function prettyClock(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const m = /^"?(\d{1,2}):(\d{2})/.exec(value);
  if (!m) {
    return null;
  }
  const h = Number(m[1]);
  if (!Number.isFinite(h) || h > 23) {
    return null;
  }
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

/**
 * Load topbar counts in parallel. Individual failures return null so pageHeader can use static
 * subtitles without failing the portal layout.
 */
async function getTopbarStats(): Promise<TopbarStats> {
  const now = new Date();
  const ist = 'Asia/Kolkata';
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: ist, ...opts }).format(now);

  const base: TopbarStats = {
    todayLabel: fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    periodLabel: fmt({ month: 'long', year: 'numeric' }),
    year: Number(todayISO().slice(0, 4)),
    activeEmployees: null,
    branches: [],
    pendingApprovals: null,
    runStatus: null,
    nightSweep: null,
  };

  if (!isMongoConfigured()) {
    return base;
  }

  try {
    const dbc = await createClient();
    const periodMonth = `${todayISO().slice(0, 7)}-01`;
    const [employees, branches, approvals, run, sweep] = await Promise.all([
      dbc
        .from('employees')
        .select('code', { count: 'exact', head: true })
        .in('status', ['active', 'on_notice']),
      dbc.from('branches').select('name').order('name'),
      dbc.from('requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      dbc
        .from('payroll_runs')
        .select('status')
        .eq('period_month', periodMonth)
        .maybeSingle<{ status: string }>(),
      dbc
        .from('settings')
        .select('value')
        .eq('key', 'night_sweep_time')
        .maybeSingle<{ value: unknown }>(),
    ]);

    return {
      ...base,
      activeEmployees: employees.error ? null : (employees.count ?? null),
      branches: branches.error ? [] : (branches.data ?? []).map((b: any) => b.name as string),
      pendingApprovals: approvals.error ? null : (approvals.count ?? null),
      runStatus: run.error ? null : (run.data?.status ?? null),
      nightSweep: sweep.error ? null : prettyClock(sweep.data?.value),
    };
  } catch {
    return base;
  }
}

export { getTodayBoard, getPunchLogToday, getCelebrationsToday, getActivityFeed, getTopbarStats };

export type { ActivityRow };
