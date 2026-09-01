// ============================================================================
// The TV attendance board — one row per active employee, resolved for today.
//
// Live in/out comes from the punch_events trail, NOT from
// attendance_days.punch_out. On a day with a lunch break the resolved row holds
// the FIRST in and the LAST out, so "punch_in set and punch_out null" reports
// someone who came back from lunch as gone. The last event per employee is the
// only reliable answer. attendance_days is still read, for the day's HR status
// (leave, week off, holiday) and the worked total.
// ============================================================================
import { createClient } from '@/lib/db/server';
import { todayIST } from '@/lib/format';
// The board reads punch_events, so it uses the punch module's own definitions
// of "the day floor" and "the instant this row holds" rather than keeping a
// second copy. The copy is what broke it: this file's dayFloorUtc still
// returned an ISO STRING after punched_at became a BSON date, and MongoDB
// brackets comparisons by type — so `punched_at >= '<string>'` matched nothing
// and the wall board showed an empty floor all day.
import { dayFloorUtc, punchInstant } from '@/lib/punch';
import type { BoardData, EmployeeData, Presence } from '@/lib/types/employee';

const BUSINESS_TZ = 'Asia/Kolkata';

function dayOf(timestamp: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ }).format(
    punchInstant(timestamp),
  );
}

/**
 * Day statuses that mean "not expected in", so an absent card is not alarming.
 * Approved leave is split out from the calendar reasons: on a wall board "on
 * leave" and "it is their week off" are different facts about a person.
 */
const LEAVE_STATUSES = new Set(['L', 'CO']);
const OFF_STATUSES = new Set(['WO', 'OH']);

export async function readBoard(): Promise<BoardData> {
  const dbc = await createClient();
  const date = todayIST();

  const [employees, days, events] = await Promise.all([
    dbc
      .from('employees')
      .select('id, code, full_name, designation, branches(name), departments(name)')
      .eq('status', 'active')
      .order('full_name'),
    dbc
      .from('attendance_days')
      .select<{ employee_id: string; status: string; worked_minutes: number }[]>(
        'employee_id, status, worked_minutes',
      )
      .eq('work_date', date),
    dbc
      .from('punch_events')
      .select<{ employee_id: string; kind: string; punched_at: Date | string; within_geofence: boolean | null }[]>(
        'employee_id, kind, punched_at, within_geofence',
      )
      .gte('punched_at', dayFloorUtc(date))
      .order('punched_at', { ascending: true }),
  ]);

  if (employees.error) throw new Error(employees.error.message);
  if (days.error) throw new Error(days.error.message);
  if (events.error) throw new Error(events.error.message);

  const dayByEmployee = new Map(
    (days.data ?? []).map((row) => [row.employee_id, row]),
  );

  // Ascending order means the last write per employee wins — the latest punch.
  const lastEvent = new Map<string, { kind: string; punched_at: Date | string; within_geofence: boolean | null }>();
  for (const event of events.data ?? []) {
    if (dayOf(event.punched_at) !== date) continue;
    lastEvent.set(event.employee_id, event);
  }

  const rows: EmployeeData[] = (employees.data ?? []).map((employee: any) => {
    const day = dayByEmployee.get(employee.id);
    const last = lastEvent.get(employee.id);
    const dayStatus: string | null = day?.status ?? null;

    // A punch outranks the calendar: someone who came in on their week off is
    // on the floor, whatever the day's status says.
    let presence: Presence;
    if (last) presence = last.kind === 'in' ? 'in' : 'out';
    else if (dayStatus && LEAVE_STATUSES.has(dayStatus)) presence = 'leave';
    else if (dayStatus && OFF_STATUSES.has(dayStatus)) presence = 'off';
    else presence = 'awaited';

    return {
      id: employee.id,
      code: employee.code ?? '',
      name: employee.full_name ?? '',
      designation: employee.designation ?? null,
      department: employee.departments?.name ?? null,
      branch: employee.branches?.name ?? null,
      presence,
      // An ISO string for the client, not the raw column.
      lastPunchAt: last ? punchInstant(last.punched_at).toISOString() : null,
      lastKind: (last?.kind as 'in' | 'out' | undefined) ?? null,
      withinGeofence: last?.within_geofence ?? null,
      workedMinutes: day?.worked_minutes ?? 0,
      dayStatus,
    };
  });

  // On the wall, who is here matters most; then who has been and gone; then
  // who is still expected. Alphabetical within each band so a name keeps a
  // stable place between refreshes.
  const order: Record<Presence, number> = { in: 0, out: 1, awaited: 2, off: 3, leave: 4 };
  rows.sort(
    (a, b) => order[a.presence] - order[b.presence] || a.name.localeCompare(b.name),
  );

  const count = (presence: Presence) => rows.filter((r) => r.presence === presence).length;
  const totals = {
    in: count('in'),
    out: count('out'),
    off: count('off'),
    leave: count('leave'),
    awaited: count('awaited'),
    headcount: rows.length,
  };

  return { date, generatedAt: new Date().toISOString(), rows, totals };
}
