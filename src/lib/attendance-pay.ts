import { isScheduledWeekOff } from '@/lib/weekly-off-policy';
import type { WeekOffPolicy } from '@/lib/weekly-off-policy';

interface AttendancePayDay {
  workDate: string;
  status: string;
  workedMinutes: number;
}

interface AttendanceCalendar {
  policy: WeekOffPolicy;
  holidays: Array<{ date: string; branchId: string | null }>;
}

function dayCredit(status: string): { working: number; payable: number } {
  if (['P', 'T', 'S', 'LM'].includes(status)) {
    return { working: 1, payable: 1 };
  }
  if (status === 'HD') {
    return { working: 0.5, payable: 0.5 };
  }
  return { working: 0, payable: ['WO', 'OH', 'CO'].includes(status) ? 1 : 0 };
}

/** Explicit attendance wins over calendar defaults. Last stored revision wins; a date pays once. */
function uniqueAttendance(days: AttendancePayDay[]): AttendancePayDay[] {
  return [...new Map(days.map((day) => [day.workDate, day])).values()];
}

function attendancePaySummary(days: AttendancePayDay[]) {
  let workingDays = 0;
  let payableDays = 0;
  let workedMinutes = 0;
  for (const day of uniqueAttendance(days)) {
    const credit = dayCredit(day.status);
    workingDays += credit.working;
    payableDays += credit.payable;
    workedMinutes += day.workedMinutes;
  }
  return { workingDays, payableDays, workedMinutes };
}

function resolvePayableAttendance(
  periodMonth: string,
  recorded: AttendancePayDay[],
  employee: {
    branchId: string | null;
    dateOfJoining: string | null;
    lastWorkingDay: string | null;
  },
  calendar: AttendanceCalendar,
  today: string,
): AttendancePayDay[] {
  const prefix = periodMonth.slice(0, 7);
  const days = uniqueAttendance(recorded).filter(
    (day) =>
      day.workDate.startsWith(`${prefix}-`) &&
      (!employee.dateOfJoining || day.workDate >= employee.dateOfJoining) &&
      (!employee.lastWorkingDay || day.workDate <= employee.lastWorkingDay),
  );
  // Preserve the existing eligibility rule for implicit paid days off.
  if (!days.some((day) => dayCredit(day.status).working > 0)) {
    return days;
  }
  const seen = new Set(days.map((day) => day.workDate));
  const holidays = new Set(
    calendar.holidays
      .filter((holiday) => holiday.branchId === null || holiday.branchId === employee.branchId)
      .map((holiday) => holiday.date),
  );
  const [year, month] = prefix.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= count; day++) {
    const workDate = `${prefix}-${String(day).padStart(2, '0')}`;
    if (
      seen.has(workDate) ||
      workDate > today ||
      (employee.dateOfJoining && workDate < employee.dateOfJoining) ||
      (employee.lastWorkingDay && workDate > employee.lastWorkingDay)
    ) {
      continue;
    }
    const status = holidays.has(workDate)
      ? 'OH'
      : isScheduledWeekOff(workDate, calendar.policy)
        ? 'WO'
        : null;
    if (status) {
      days.push({ workDate, status, workedMinutes: 0 });
    }
  }
  return days.sort((a, b) => a.workDate.localeCompare(b.workDate));
}

export { attendancePaySummary, uniqueAttendance, resolvePayableAttendance };
export type { AttendancePayDay, AttendanceCalendar };
