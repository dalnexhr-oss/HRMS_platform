// Build today's TV attendance rows. Use each employee's latest punch event for current in/out
// state; attendance_days holds daily totals and cannot distinguish a return from lunch.
import { createClient } from '@/lib/db/server';
import { todayIST } from '@/lib/format';
// Share the punch module's day boundaries and timestamp conversion. MongoDB comparisons must use
// BSON dates for punched_at.
import { dayFloorUtc, punchInstant } from '@/lib/punch';
import type { BoardData, EmployeeData, Presence } from '@/types/tv';

const bussinessTimeZone = 'Asia/Kolkata';

function dayOf(timestamp: Date | string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: bussinessTimeZone }).format(
    punchInstant(timestamp),
  );
}

// Day statuses that mean "not expected in", so an absent card is not alarming. Approved leave is
// split out from the calendar reasons: on a wall board "on leave" and "it is their week off" are
// different facts about a person.
const leaveStauses = new Set(['L', 'CO']);
const offStauses = new Set(['WO', 'OH']);

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
      .select<
        {
          employee_id: string;
          kind: string;
          punched_at: Date | string;
          within_geofence: boolean | null;
        }[]
      >('employee_id, kind, punched_at, within_geofence')
      .gte('punched_at', dayFloorUtc(date))
      .order('punched_at', { ascending: true }),
  ]);

  if (employees.error) throw new Error(employees.error.message);
  if (days.error) throw new Error(days.error.message);
  if (events.error) throw new Error(events.error.message);

  const dayByEmployee = new Map((days.data ?? []).map((row) => [row.employee_id, row]));

  // Ascending order means the last write per employee wins — the latest punch.
  const lastEvent = new Map<
    string,
    { kind: string; punched_at: Date | string; within_geofence: boolean | null }
  >();
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
    else if (dayStatus && leaveStauses.has(dayStatus)) presence = 'leave';
    else if (dayStatus && offStauses.has(dayStatus)) presence = 'off';
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
  rows.sort((a, b) => order[a.presence] - order[b.presence] || a.name.localeCompare(b.name));

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
