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

/**
 * Count the leave days in an inclusive span, honouring the sandwich policy.
 *
 * WITHOUT the policy (the default), a week-off or holiday inside the span is not
 * leave: Friday + Monday off across a weekend costs 2 days.
 *
 * WITH the policy on, non-working days that fall BETWEEN two leave days are
 * bridged and counted: the same Friday–Monday costs 4. That is the point of the
 * rule — otherwise an employee splits leave around every weekend and the bridged
 * days are free, which is a real cost leak.
 *
 * Both modes only ever count days INSIDE the span, and a leading/trailing
 * non-working day is never charged (taking "leave" on a Sunday costs nothing),
 * because bridging requires a leave day on both sides.
 *
 * `holidays` is a set of 'YYYY-MM-DD' strings. Pure function — the caller loads
 * the policy and holiday list.
 */
export function countLeaveDays(
  startISO: string,
  endISO: string,
  opts: {
    policy?: WeekOffPolicy;
    holidays?: ReadonlySet<string>;
    sandwich?: boolean;
  } = {},
): number {
  const { policy = DEFAULT_WEEK_OFF_POLICY, holidays = new Set<string>(), sandwich = false } = opts;

  const start = utcDate(startISO);
  const end = utcDate(endISO);
  if (!start || !end || end.getTime() < start.getTime()) return 0;

  // Enumerate the span, flagging which days are non-working.
  const days: { iso: string; off: boolean }[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const iso = cursor.toISOString().slice(0, 10);
    days.push({ iso, off: isScheduledWeekOff(iso, policy) || holidays.has(iso) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const workingCount = days.filter((d) => !d.off).length;
  if (!sandwich) return workingCount;

  // Sandwich: charge every day from the FIRST to the LAST working day inclusive,
  // so interior non-working days are bridged and the edges are still free. When
  // the span contains no working day at all there is nothing to bridge.
  const first = days.findIndex((d) => !d.off);
  if (first === -1) return 0;
  let last = days.length - 1;
  while (last > first && days[last].off) last -= 1;
  return last - first + 1;
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
