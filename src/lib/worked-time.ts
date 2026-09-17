/** Standard attendance day: 9 hours 15 minutes, measured in whole minutes. */
export const standardDayMinutes = 9 * 60 + 15;

// Match the attendance strip's definition of being at work; paid leave and half-days are separate.
const presentStatuses = new Set(['P', 'LM', 'S', 'T']);

interface WorkedDay {
  work_date: string;
  status: string;
  worked_minutes: number | null;
}

/** Net surplus on present days in the selected month through today (both dates are IST dates). */
export function presentDaySurplus(
  days: readonly WorkedDay[],
  periodMonth: string,
  today: string,
): { presentDays: number; surplusMinutes: number } {
  let presentDays = 0;
  let workedMinutes = 0;
  for (const day of days) {
    if (
      day.work_date.slice(0, 7) !== periodMonth.slice(0, 7) ||
      day.work_date > today ||
      !presentStatuses.has(day.status)
    ) {
      continue;
    }
    presentDays++;
    workedMinutes += Math.max(0, day.worked_minutes ?? 0);
  }
  return {
    presentDays,
    surplusMinutes: Math.max(0, workedMinutes - presentDays * standardDayMinutes),
  };
}
