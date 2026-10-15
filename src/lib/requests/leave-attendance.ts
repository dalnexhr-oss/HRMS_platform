import 'server-only';
import { createClient } from '@/lib/db/server-client';
import { countLeaveDays, isScheduledWeekOff, policyFromSettings } from '@/lib/attendance/weekly-off-policy';
import { reserveAttendanceMonth } from '@/lib/db/write-reservations';

type DbClient = Awaited<ReturnType<typeof createClient>>;

function inclusiveDays(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function enumerateDays(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  while (cursor <= end && out.length < 1000) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

async function leaveCalendar(client: DbClient, employeeId: string) {
  const employee = await client
    .from('employees')
    .select('branch_id')
    .eq('id', employeeId)
    .maybeSingle();
  if (employee.error || !employee.data) {
    throw new Error(employee.error?.message ?? 'The employee no longer exists.');
  }
  const settings = await client
    .from('settings')
    .select('key, value')
    .in('key', [
      'week_off_weekdays',
      'working_saturdays',
      'leave_sandwich_policy',
      'full_day_minutes',
    ]);
  if (settings.error) {
    throw new Error(settings.error.message);
  }
  const values = new Map((settings.data ?? []).map((row) => [String(row.key), row.value]));
  const holidays = await client.from('holidays').select('holiday_date, branch_id');
  if (holidays.error) {
    throw new Error(holidays.error.message);
  }
  return {
    policy: policyFromSettings(values.get('week_off_weekdays'), values.get('working_saturdays')),
    holidays: new Set(
      (holidays.data ?? [])
        .filter(
          (holiday) => holiday.branch_id == null || holiday.branch_id === employee.data!.branch_id,
        )
        .map((holiday) => String(holiday.holiday_date)),
    ),
    sandwich:
      values.get('leave_sandwich_policy') === true ||
      values.get('leave_sandwich_policy') === 'true',
    fullDayMinutes:
      Number(values.get('full_day_minutes')) > 0 ? Number(values.get('full_day_minutes')) : 555,
  };
}

async function leaveDayCount(
  startISO: string,
  endISO: string,
  employeeId: string,
): Promise<number> {
  const calendar = await leaveCalendar(await createClient(), employeeId);
  return countLeaveDays(startISO, endISO, calendar);
}

const dutyStamps: Record<string, 'S' | 'T'> = { site_visit: 'S', outdoor_duty: 'T', wfh: 'T' };

function stampLeaveOnRegister(client: DbClient, employeeId: string, start: string, end: string) {
  return stampApprovedDays(client, employeeId, start, end, 'L');
}

function stampDutyOnRegister(
  client: DbClient,
  employeeId: string,
  type: string,
  start: string,
  end: string,
) {
  return stampApprovedDays(client, employeeId, start, end, dutyStamps[type]);
}

async function reserveMonths(days: string[]): Promise<void> {
  for (const month of [...new Set(days.map((day) => day.slice(0, 7)))].sort()) {
    await reserveAttendanceMonth(`${month}-01`);
  }
}

/** Errors abort the approval transaction. Existing presence and explicit off-days stay intact. */
async function stampApprovedDays(
  client: DbClient,
  employeeId: string,
  start: string,
  end: string,
  status?: 'L' | 'S' | 'T',
): Promise<null> {
  if (!status) {
    return null;
  }
  const days = enumerateDays(start, end);
  await reserveMonths(days);
  const calendar = await leaveCalendar(client, employeeId);
  const existing = await client
    .from('attendance_days')
    .select('work_date, status')
    .eq('employee_id', employeeId)
    .gte('work_date', start)
    .lte('work_date', end);
  if (existing.error) {
    throw new Error(existing.error.message);
  }
  const byDate = new Map(
    (existing.data ?? []).map((row) => [String(row.work_date), String(row.status)]),
  );
  const stamp = { status, worked_minutes: status === 'L' ? 0 : calendar.fullDayMinutes };
  for (const day of days) {
    if (calendar.holidays.has(day) || isScheduledWeekOff(day, calendar.policy)) {
      continue;
    }
    const current = byDate.get(day);
    if (current === 'AB') {
      const result = await client
        .from('attendance_days')
        .update(stamp)
        .eq('employee_id', employeeId)
        .eq('work_date', day)
        .eq('status', 'AB')
        .select('id');
      if (result.error || !result.data?.length) {
        throw new Error(result.error?.message ?? 'Attendance changed. Retry the approval.');
      }
    } else if (current === undefined) {
      const result = await client
        .from('attendance_days')
        .insert({ employee_id: employeeId, work_date: day, ...stamp });
      if (result.error) {
        throw new Error(result.error.message);
      }
    }
  }
  return null;
}

async function unstampApprovedDays(
  client: DbClient,
  employeeId: string,
  type: string,
  start: string,
  end: string,
): Promise<null> {
  const status = type === 'leave' ? 'L' : dutyStamps[type];
  if (!status) {
    return null;
  }
  await reserveMonths(enumerateDays(start, end));
  const result = await client
    .from('attendance_days')
    .delete()
    .eq('employee_id', employeeId)
    .eq('status', status)
    .is('punch_in', null)
    .neq('is_corrected', true)
    .gte('work_date', start)
    .lte('work_date', end);
  if (result.error) {
    throw new Error(result.error.message);
  }
  return null;
}

export {
  inclusiveDays,
  leaveDayCount,
  stampLeaveOnRegister,
  stampDutyOnRegister,
  unstampApprovedDays,
};
