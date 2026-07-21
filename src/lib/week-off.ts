// ============================================================================
// The week-off schedule — which calendar days are scheduled off.
//
// Dalnex works the **2nd and 4th Saturday** of each month; the 1st, 3rd and 5th
// Saturdays are week-offs, and every Sunday is off. Both halves are settings
// (migration 0010) so the rule can change without a code deploy.
//
// This module is the single implementation. It is PURE — no Supabase, no React —
// so the register, the comp-off check and any future scheduler all agree.
// ============================================================================

export interface WeekOffPolicy {
  /** Weekdays always off, JS getUTCDay(): 0=Sunday … 6=Saturday. */
  weekOffWeekdays: number[];
  /** Saturdays of the month that ARE worked (1=first … 5=fifth). */
  workingSaturdays: number[];
}

/** Sundays off; Saturdays off except the 2nd and 4th, which are worked. */
export const DEFAULT_WEEK_OFF_POLICY: WeekOffPolicy = {
  weekOffWeekdays: [0, 6],
  workingSaturdays: [2, 4],
};

const SATURDAY = 6;

/** Parse a settings jsonb value into a number[], or null when unusable. */
function numberList(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map(Number).filter((n) => Number.isFinite(n));
  return out.length === value.length ? out : null;
}

/**
 * Build a policy from raw settings values, falling back per-field so one bad
 * setting can't silently disable the whole schedule.
 */
export function policyFromSettings(
  weekOffWeekdays: unknown,
  workingSaturdays: unknown,
): WeekOffPolicy {
  return {
    weekOffWeekdays: numberList(weekOffWeekdays) ?? DEFAULT_WEEK_OFF_POLICY.weekOffWeekdays,
    workingSaturdays: numberList(workingSaturdays) ?? DEFAULT_WEEK_OFF_POLICY.workingSaturdays,
  };
}

/** 'YYYY-MM-DD' -> a UTC Date, or null when unparseable. */
function utcDate(dateISO: string): Date | null {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Which occurrence of its weekday this date is within its month.
 * The 8th of a month is always the 2nd of that weekday, the 15th the 3rd, etc.
 */
export function weekdayOrdinal(dateISO: string): number | null {
  const d = utcDate(dateISO);
  if (!d) return null;
  return Math.floor((d.getUTCDate() - 1) / 7) + 1;
}

/**
 * Is this date a scheduled week-off?
 *
 * A Saturday listed in `workingSaturdays` (by its ordinal in the month) is a
 * WORKING day even though Saturday is in `weekOffWeekdays` — that exception is
 * the whole point of the rule.
 */
export function isScheduledWeekOff(
  dateISO: string,
  policy: WeekOffPolicy = DEFAULT_WEEK_OFF_POLICY,
): boolean {
  const d = utcDate(dateISO);
  if (!d) return false;
  const dow = d.getUTCDay();
  if (!policy.weekOffWeekdays.includes(dow)) return false;

  if (dow === SATURDAY) {
    const ordinal = weekdayOrdinal(dateISO);
    if (ordinal !== null && policy.workingSaturdays.includes(ordinal)) return false;
  }
  return true;
}

/** Days-of-month that are scheduled week-offs for a 'YYYY-MM-01' period. */
export function weekOffDaysInMonth(
  periodMonth: string,
  policy: WeekOffPolicy = DEFAULT_WEEK_OFF_POLICY,
): number[] {
  const ym = periodMonth.slice(0, 7);
  const first = utcDate(`${ym}-01`);
  if (!first) return [];
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();

  const out: number[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    if (isScheduledWeekOff(`${ym}-${String(day).padStart(2, '0')}`, policy)) out.push(day);
  }
  return out;
}

/** Human summary for the settings/register UI, e.g. "Sun off · Sat off except 2nd, 4th". */
export function describePolicy(policy: WeekOffPolicy = DEFAULT_WEEK_OFF_POLICY): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const off = policy.weekOffWeekdays.filter((d) => d !== SATURDAY).map((d) => names[d] ?? d);
  const parts: string[] = [];
  if (off.length) parts.push(`${off.join(', ')} off`);
  if (policy.weekOffWeekdays.includes(SATURDAY)) {
    parts.push(
      policy.workingSaturdays.length
        ? `Sat off except ${policy.workingSaturdays
            .slice()
            .sort((a, b) => a - b)
            .map((n) => `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`)
            .join(', ')}`
        : 'Sat off',
    );
  }
  return parts.join(' · ');
}
