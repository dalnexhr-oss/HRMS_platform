// Build leave-salary rows for both the page and Excel export from the same roster, attendance, and
// saved workings. Pure calculations live in leave-salary.ts.
import {
  getLeaveSalaryPresence,
  getLeaveSalaryRoster,
  getLeaveSalaryWorkings,
  type LeaveSalaryWorkingRow,
} from '@/lib/queries';
import { computeLeaveSalary, type LeaveSalaryResult } from '@/lib/leave-salary';

// Increment month when nothing is saved: April — appraisals land in March.
export const defaultIncrementMonth = 4;

export interface LeaveSalaryViewRow {
  employeeId: string;
  code: string;
  name: string;
  // false = inactive employee kept on the sheet by a saved working.
  onRoster: boolean;
  // Inputs — the saved working wins; otherwise both default to gross.
  salaryBefore: number;
  salaryAfter: number;
  incrementMonth: number;
  remarks: string;
  // Credit-weighted presence per month (index 0 = Jan), from attendance.
  monthlyPresence: number[];
  // Explicit period denominators from saved working; null = calculated from calendar.
  calendarDaysP1Override: number | null;
  calendarDaysP2Override: number | null;
  // Computed from CURRENT attendance + the inputs above.
  live: LeaveSalaryResult;
  // The saved row, when one exists. Authoritative once status ≠ draft.
  working: LeaveSalaryWorkingRow | null;
  // A finalized/paid snapshot no longer matches current attendance — someone edited the register
  // after the working was locked. The snapshot stays authoritative; this flag is how the UI says
  // "look again".
  drift: boolean;
}

export interface LeaveSalaryView {
  year: number;
  // Indicates availability of saved workings collection.
  migrated: boolean;
  rows: LeaveSalaryViewRow[];
}

export async function buildLeaveSalaryView(year: number): Promise<LeaveSalaryView> {
  const [roster, presence, workings] = await Promise.all([
    getLeaveSalaryRoster(year),
    getLeaveSalaryPresence(year),
    getLeaveSalaryWorkings(year),
  ]);

  const byEmployee = new Map<string, LeaveSalaryWorkingRow>(
    (workings ?? []).map((w) => [w.employeeId, w]),
  );

  const rows = roster.map((e): LeaveSalaryViewRow => {
    const working = byEmployee.get(e.id) ?? null;
    const monthlyPresence = presence[e.id] ?? new Array(12).fill(0);

    const salaryBefore = working ? working.salaryBefore : e.grossMonthly;
    const salaryAfter = working ? working.salaryAfter : e.grossMonthly;
    const incrementMonth = working
      ? Number(working.incrementEffective.slice(5, 7)) || defaultIncrementMonth
      : defaultIncrementMonth;

    const calendarDaysP1Override = working?.calendarDaysP1Override ?? null;
    const calendarDaysP2Override = working?.calendarDaysP2Override ?? null;

    // Live honours the saved overrides, so "drift" keeps meaning "attendance
    // moved under a locked snapshot" — an overridden denominator can't drift.
    const live = computeLeaveSalary({
      year,
      salaryBefore,
      salaryAfter,
      incrementMonth,
      monthlyPresence,
      calendarDaysP1Override,
      calendarDaysP2Override,
    });

    // Money compares within a paisa; presence within a half-day step.
    const drift =
      working !== null &&
      working.status !== 'draft' &&
      (Math.abs(working.totalAmount - live.total) > 0.01 ||
        Math.abs(working.presentP1 - live.p1.presentDays) > 0.01 ||
        Math.abs(working.presentP2 - live.p2.presentDays) > 0.01);

    return {
      employeeId: e.id,
      code: e.code,
      name: e.name,
      onRoster: e.status === 'active' || e.status === 'on_notice',
      salaryBefore,
      salaryAfter,
      incrementMonth,
      remarks: working?.remarks ?? '',
      monthlyPresence,
      calendarDaysP1Override,
      calendarDaysP2Override,
      live,
      working,
      drift,
    };
  });

  return { year, migrated: workings !== null, rows };
}
