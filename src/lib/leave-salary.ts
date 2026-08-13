// ============================================================================
// Leave-salary computation — the owner's Excel, as one pure module.
//
// Policy: 15 days of paid leave a year is worth half a month's gross. The year
// splits at the appraisal (increment effective a month boundary, normally
// 1 April), each period is entitled to (salary/2) × months/12, and the payable
// amount scales by how much of the period the employee was actually present:
//
//   payable_p = (salary_p / 2) × (months_p / 12) × (present_p / calendar_p)
//
// Worked sample from the sheet (year 2025, increment April) — the by-inspection
// test for this module, since the repo has no test runner:
//   salaryBefore 25000, salaryAfter 30000
//   present  86 / 90   (Jan–Mar)   → entitled 3125.00, payable  2986.11
//   present 258.5 / 275 (Apr–Dec)  → entitled 11250.00, payable 10575.00
//   total 13561.11
//
// No server imports: the client table uses it for live preview, the server
// actions for the authoritative snapshot, the export for the sheet — one
// formula, three call sites, zero drift.
// ============================================================================
import type { AttendanceStatus } from '@/types/database';

/**
 * Presence credit per attendance status. Week-offs, holidays and comp-offs
 * COUNT as present — the sheet's 344.5-of-365 sample year is impossible
 * otherwise. Only Absent and Leave reduce the payout; a half day is half.
 */
export const PRESENT_CREDIT: Record<AttendanceStatus, number> = {
  P: 1,
  LM: 1,
  S: 1,
  T: 1,
  WO: 1,
  OH: 1,
  CO: 1,
  HD: 0.5,
  L: 0,
  AB: 0,
};

/**
 * Credit-weighted presence per calendar month (index 0 = January) from raw
 * attendance rows. Rows outside the intended year, with unknown statuses, or
 * with malformed dates contribute nothing rather than throwing — attendance is
 * imported from spreadsheets and this must not die on one bad row.
 */
export function presenceByMonth(rows: { workDate: string; status: string }[]): number[] {
  const months = new Array(12).fill(0);
  for (const row of rows) {
    const month = Number(row.workDate?.slice(5, 7));
    if (!Number.isInteger(month) || month < 1 || month > 12) continue;
    months[month - 1] += PRESENT_CREDIT[row.status as AttendanceStatus] ?? 0;
  }
  return months;
}

export interface LeaveSalaryInput {
  year: number;
  /** Monthly gross before the increment. */
  salaryBefore: number;
  /** Monthly gross from the increment on. */
  salaryAfter: number;
  /** 1–12; 4 = the default 1 April split. 1 = whole year on salaryAfter. */
  incrementMonth: number;
  /** presenceByMonth() output — credit-weighted days, index 0 = January. */
  monthlyPresence: number[];
  /**
   * HR-entered calendar-day DENOMINATORS (migration 0041): payable =
   * entitled × present ÷ days, and these replace `days`. null/undefined =
   * real calendar arithmetic, the pre-0041 behaviour. The attendance-derived
   * present-day numerator is never overridden.
   */
  calendarDaysP1Override?: number | null;
  calendarDaysP2Override?: number | null;
}

export interface PeriodFigures {
  /** Whole months in the period (3 / 9 for the default April split). */
  months: number;
  /** Real calendar days — leap-safe (Jan–Mar is 91 in 2028, 90 in 2025). */
  calendarDays: number;
  /** Credit-weighted present days. */
  presentDays: number;
  /** (salary / 2) × months / 12, unrounded. */
  entitled: number;
  /** entitled × presentDays / calendarDays, rounded to 2 dp. */
  payable: number;
}

export interface LeaveSalaryResult {
  /** Before the increment (empty period when incrementMonth = 1). */
  p1: PeriodFigures;
  /** From the increment on. */
  p2: PeriodFigures;
  /** payable p1 + payable p2, 2 dp. */
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Calendar days in [startMonth, endMonth] (1-based, inclusive) of `year`. */
function calendarDays(year: number, startMonth: number, endMonth: number): number {
  if (endMonth < startMonth) return 0;
  // Day 0 of month m+1 is the last day of month m — leap-safe by construction.
  const start = Date.UTC(year, startMonth - 1, 1);
  const end = Date.UTC(year, endMonth, 0);
  return Math.round((end - start) / 86_400_000) + 1;
}

function periodFigures(
  salary: number,
  year: number,
  startMonth: number,
  endMonth: number,
  monthlyPresence: number[],
): PeriodFigures {
  const months = Math.max(0, endMonth - startMonth + 1);
  const days = calendarDays(year, startMonth, endMonth);
  let present = 0;
  for (let m = startMonth; m <= endMonth; m++) present += monthlyPresence[m - 1] ?? 0;
  const entitled = (salary / 2) * (months / 12);
  // Guard the empty period (incrementMonth = 1 ⇒ p1 has 0 days): 0, never NaN.
  const payable = days > 0 ? round2(entitled * (present / days)) : 0;
  return { months, calendarDays: days, presentDays: present, entitled, payable };
}

/**
 * The whole working for one employee-year. Presence beyond the period counts
 * for nothing; presence rows that don't exist (an employee who joined mid-year
 * has no earlier attendance) self-pro-rate the payout, because the denominator
 * stays the full period while the numerator only holds real days.
 */
/**
 * Replace the calendar-day denominator with an HR-typed one (0041). A zero,
 * negative or non-finite override is ignored rather than dividing by it.
 * Skipped entirely for an empty period (incrementMonth = 1 ⇒ p1 has 0 months)
 * — there is nothing to pro-rate.
 */
function withCalendarOverride(f: PeriodFigures, override: number | null | undefined): PeriodFigures {
  if (override == null || !Number.isFinite(override) || override <= 0) return f;
  if (f.months === 0) return f;
  const days = Math.round(override);
  return { ...f, calendarDays: days, payable: round2(f.entitled * (f.presentDays / days)) };
}

export function computeLeaveSalary(input: LeaveSalaryInput): LeaveSalaryResult {
  const { year, salaryBefore, salaryAfter, monthlyPresence } = input;
  // An out-of-range increment month would silently misshape both periods;
  // clamp to [1, 12] so p1 is at most Jan–Nov and p2 at least December.
  const inc = Math.min(12, Math.max(1, Math.trunc(input.incrementMonth)));

  const p1 = withCalendarOverride(
    periodFigures(salaryBefore, year, 1, inc - 1, monthlyPresence),
    input.calendarDaysP1Override,
  );
  const p2 = withCalendarOverride(
    periodFigures(salaryAfter, year, inc, 12, monthlyPresence),
    input.calendarDaysP2Override,
  );
  return { p1, p2, total: round2(p1.payable + p2.payable) };
}

/** The stored figures of a saved working, as every surface consumes them. */
export interface WorkingSnapshot {
  status: 'draft' | 'finalized' | 'paid';
  presentP1: number;
  presentP2: number;
  calendarDaysP1: number;
  calendarDaysP2: number;
  amountP1: number;
  amountP2: number;
  totalAmount: number;
}

export interface EffectiveFigures {
  presentP1: number;
  presentP2: number;
  calendarDaysP1: number;
  calendarDaysP2: number;
  amountP1: number;
  amountP2: number;
  total: number;
}

/**
 * The figures a row should REPORT: the frozen snapshot once finalized/paid,
 * the live computation while still a draft (or unsaved). One rule, applied by
 * the page table AND the .xlsx export, so screen and sheet cannot disagree.
 */
export function effectiveFigures(
  working: WorkingSnapshot | null,
  live: LeaveSalaryResult,
): EffectiveFigures {
  if (working && working.status !== 'draft') {
    return {
      presentP1: working.presentP1,
      presentP2: working.presentP2,
      calendarDaysP1: working.calendarDaysP1,
      calendarDaysP2: working.calendarDaysP2,
      amountP1: working.amountP1,
      amountP2: working.amountP2,
      total: working.totalAmount,
    };
  }
  return {
    presentP1: live.p1.presentDays,
    presentP2: live.p2.presentDays,
    calendarDaysP1: live.p1.calendarDays,
    calendarDaysP2: live.p2.calendarDays,
    amountP1: live.p1.payable,
    amountP2: live.p2.payable,
    total: live.total,
  };
}
