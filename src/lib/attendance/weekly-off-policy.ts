// Calendar rules shared by attendance, leave and payroll.

const SUNDAY = 0;
const SATURDAY = 6;
const DAYS_PER_WEEK = 7;

// The weekly off policy is a combination of regular days off and working Saturdays.
// The regular days off are the weekdays that are always off,
// while the working Saturdays are the specific Saturdays that are considered working days.

interface WeekOffPolicy {
  weekOffWeekdays: number[];
  workingSaturdays: number[];
}

interface LeaveDayCountOptions {
  policy?: WeekOffPolicy;
  holidays?: ReadonlySet<string>;
  sandwich?: boolean;
}

const defaultWeekOffPolicy: WeekOffPolicy = {
  weekOffWeekdays: [SUNDAY, SATURDAY],
  workingSaturdays: [2, 4],
};

function policyFromSettings(weekOffWeekdays: unknown, workingSaturdays: unknown): WeekOffPolicy {
  return {
    weekOffWeekdays: parseNumberArray(weekOffWeekdays) ?? defaultWeekOffPolicy.weekOffWeekdays,
    workingSaturdays: parseNumberArray(workingSaturdays) ?? defaultWeekOffPolicy.workingSaturdays,
  };
}

// Returns the ordinal occurrence of the weekday in the month, for example 2 for the second Saturday. Returns null if the date is invalid.
function weekdayOrdinal(dateISO: string): number | null {
  const date = parseUtcDate(dateISO);
  return date ? getWeekdayOccurrence(date) : null;
}

// Returns true if the date is a scheduled weekly off according to the policy, false otherwise. Invalid dates are treated as not being a weekly off.
function isScheduledWeekOff(
  dateISO: string,
  policy: WeekOffPolicy = defaultWeekOffPolicy,
): boolean {
  const date = parseUtcDate(dateISO);
  return date !== null && isWeekOffDate(date, policy);
}

// Returns the day numbers of all scheduled weekly offs in the given month according to the policy. Invalid months return an empty array.
function weekOffDaysInMonth(
  periodMonth: string,
  policy: WeekOffPolicy = defaultWeekOffPolicy,
): number[] {
  const yearMonth = periodMonth.slice(0, 7);
  const date = parseUtcDate(`${yearMonth}-01`);
  if (!date) {
    return [];
  }

  const daysInMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const weekOffDayNumbers: number[] = [];

  for (let dayOfMonth = 1; dayOfMonth <= daysInMonth; dayOfMonth++) {
    date.setUTCDate(dayOfMonth);
    if (isWeekOffDate(date, policy)) {
      weekOffDayNumbers.push(dayOfMonth);
    }
  }

  return weekOffDayNumbers;
}

// Counts the number of leave days between two dates, excluding weekly offs and holidays. If sandwich is true, only counts days between working days.
function countLeaveDays(startDateISO: string, endDateISO: string,options: LeaveDayCountOptions = {}): number {
  const { policy = defaultWeekOffPolicy, holidays = new Set<string>(), sandwich = false } = options;
  const startDate = parseUtcDate(startDateISO);
  const endDate = parseUtcDate(endDateISO);

  if (!startDate || !endDate || endDate.getTime() < startDate.getTime()) {
    return 0;
  }

  const workingDayFlags: boolean[] = [];
  const currentDate = new Date(startDate.getTime());
  while (currentDate.getTime() <= endDate.getTime()) {
    const dateISO = currentDate.toISOString().slice(0, 10);
    const isWorkingDay = !isWeekOffDate(currentDate, policy) && !holidays.has(dateISO);
    workingDayFlags.push(isWorkingDay);
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  if (!sandwich) {
    return workingDayFlags.filter(Boolean).length;
  }

  // Only days between working days are charged. Days off at either end remain excluded.
  const firstWorkingDayIndex = workingDayFlags.indexOf(true);
  if (firstWorkingDayIndex === -1) {
    return 0;
  }
  const lastWorkingDayIndex = workingDayFlags.lastIndexOf(true);
  return lastWorkingDayIndex - firstWorkingDayIndex + 1;
}

// Returns a human-readable summary of the weekly off policy, e.g. "Sun, Mon off · Sat off except 2nd, 4th".
function describePolicy(policy: WeekOffPolicy = defaultWeekOffPolicy): string {
  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const regularDaysOff = policy.weekOffWeekdays
    .filter((weekday) => weekday !== SATURDAY)
    .map((weekday) => weekdayLabels[weekday] ?? weekday);
  const summaryParts: string[] = [];

  if (regularDaysOff.length) {
    summaryParts.push(`${regularDaysOff.join(', ')} off`);
  }

  if (policy.weekOffWeekdays.includes(SATURDAY)) {
    const workingSaturdays = policy.workingSaturdays.slice().sort((a, b) => a - b);
    const workingSaturdayLabels = workingSaturdays.map(formatSaturdayOccurrence);
    summaryParts.push(
      workingSaturdayLabels.length
        ? `Sat off except ${workingSaturdayLabels.join(', ')}`
        : 'Sat off',
    );
  }

  return summaryParts.join(' · ');
}

// Parses an unknown value as an array of numbers. Returns null if the value is not an array or contains non-numeric elements.
function parseNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const numbers = Array.from(value, Number);
  const containsInvalidNumber = numbers.some((number) => !Number.isFinite(number));
  return containsInvalidNumber ? null : numbers;
}

// Parses a date string in the format "YYYY-MM-DD" as a UTC date. Returns null if the string is not a valid date.
function parseUtcDate(dateISO: string): Date | null {
  const date = new Date(`${dateISO}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWeekdayOccurrence(date: Date): number {
  return Math.floor((date.getUTCDate() - 1) / DAYS_PER_WEEK) + 1;
}

function isWeekOffDate(date: Date, policy: WeekOffPolicy): boolean {
  const weekday = date.getUTCDay();
  if (!policy.weekOffWeekdays.includes(weekday)) {
    return false;
  }

  const isWorkingSaturday =
    weekday === SATURDAY && policy.workingSaturdays.includes(getWeekdayOccurrence(date));
  return !isWorkingSaturday;
}

function formatSaturdayOccurrence(occurrence: number): string {
  const suffixByLastDigit: Record<number, string> = { 1: 'st', 2: 'nd', 3: 'rd' };
  const suffix = suffixByLastDigit[occurrence % 10] ?? 'th';
  return `${occurrence}${suffix}`;
}

export {
  defaultWeekOffPolicy,
  policyFromSettings,
  weekdayOrdinal,
  isScheduledWeekOff,
  countLeaveDays,
  weekOffDaysInMonth,
  describePolicy,
};

export type { WeekOffPolicy, LeaveDayCountOptions };
