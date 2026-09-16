// Shared payroll-month write guard for staff actions and scheduled jobs. Locked or paid runs must
// keep their attendance unchanged because payslips can no longer be recomputed.

// The columns of a payroll_runs row this rule reads.
export interface PayrollRunSeal {
  status?: string | null;
  month_closed_at?: Date | string | null;
}

// 'YYYY-MM-DD' -> the 'YYYY-MM-01' key payroll_runs is stored under.
export function periodMonthFor(workDate: string): string {
  return `${workDate.slice(0, 7)}-01`;
}

/**
 * Why this month is sealed, or null when it is still open.
 *
 * A missing run is OPEN: a month nobody has started payroll for has nothing to
 * desync from. Callers that cannot READ the run must fail closed themselves —
 * "unknown" is not the same as "no run", and this cannot tell them apart.
 */
export function monthSealReason(periodMonth: string, run: PayrollRunSeal | null): string | null {
  const month = periodMonth.slice(0, 7);
  const status = run?.status;
  if (status === 'locked' || status === 'paid') {
    return `Payroll for ${month} is ${status}. Attendance for that month can no longer be changed — raise a payslip adjustment instead.`;
  }
  // month_closed_at is the attendance seal set by the auto-close job, and it is
  // independent of payroll status — treat a sealed month as closed too.
  if (run?.month_closed_at) {
    return `${month} has been closed for attendance. It can no longer be changed — raise a payslip adjustment instead.`;
  }
  return null;
}
