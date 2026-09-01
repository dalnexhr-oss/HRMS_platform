// ============================================================================
// Whether a month is still open for attendance changes. ONE definition.
//
// Payslips are final once a run is locked, and the recompute is blocked from
// 0005 — so rewriting the attendance behind them silently desyncs pay from the
// register, and the numbers can never catch up.
//
// This lives on its own because two different callers enforce it and they sit
// on opposite sides of the app: actions/_guard.ts guards the staff-triggered
// writes (attendance correction, the register import, the manual night sweep),
// and db/scheduler.ts guards the same writes when a cron run makes them. The
// scheduler's copy did not exist at all — /api/cron rewrote punch_out values
// behind a locked month, with the register then disagreeing with the payslips
// that were already paid — and writing a second copy to fix that is how the
// two would end up disagreeing about what "closed" means.
// ============================================================================

/** The columns of a payroll_runs row this rule reads. */
export interface PayrollRunSeal {
  status?: string | null;
  month_closed_at?: Date | string | null;
}

/** 'YYYY-MM-DD' -> the 'YYYY-MM-01' key payroll_runs is stored under. */
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
  // month_closed_at is the attendance seal set by the auto-close job (0033),
  // independent of payroll status — treat a sealed month as closed too.
  if (run?.month_closed_at) {
    return `${month} has been closed for attendance. It can no longer be changed — raise a payslip adjustment instead.`;
  }
  return null;
}
