// Date rules shared by every request an employee files: leave, duty, work from home and comp off.
import 'server-only';
import { addCalendarDays } from '@/lib/calendar-dates';
import { formatDate, todayIST } from '@/lib/display-formatting';
import type { createClient } from '@/lib/db/server-client';

// How far ahead a request may start. Longer plans are filed nearer the time.
const requestHorizonDays = 365;

const requestLabels: Record<string, string> = {
  leave: 'leave',
  comp_off: 'comp off',
  site_visit: 'site visit',
  outdoor_duty: 'outdoor duty',
  wfh: 'work from home',
};

// The reason a request cannot start on this day, or null when it can.
function requestStartProblem(startDate: string): string | null {
  const today = todayIST();
  // Requests must start today or later in IST. HR handles retrospective changes through the
  // attendance register.
  if (startDate < today) {
    return 'The start date has already passed — pick today or a later day.';
  }
  if (startDate > addCalendarDays(today, requestHorizonDays)) {
    return 'That start date is more than a year away — file the request nearer the time.';
  }
  return null;
}

// The reason these days cannot be requested because the employee already has a pending or
// approved request covering some of them, or null when the days are free.
async function requestOverlapProblem(
  dbc: Awaited<ReturnType<typeof createClient>>,
  employeeId: string,
  startDate: string,
  endDate: string,
): Promise<string | null> {
  const { data, error } = await dbc
    .from('requests')
    .select('type, start_date, end_date, status')
    .eq('employee_id', employeeId)
    .in('status', ['pending', 'approved'])
    .lte('start_date', endDate)
    .gte('end_date', startDate)
    .limit(1);
  if (error) {
    return `Could not check your existing requests: ${error.message}`;
  }
  const clash = (data ?? [])[0] as
    { type: string; start_date: string; end_date: string; status: string } | undefined;
  if (!clash) {
    return null;
  }
  const start = String(clash.start_date).slice(0, 10);
  const end = String(clash.end_date).slice(0, 10);
  const span = start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
  return `You already have a ${clash.status} ${requestLabels[clash.type] ?? clash.type} request for ${span}. Cancel it first, or pick other dates.`;
}

export { requestStartProblem, requestOverlapProblem };
