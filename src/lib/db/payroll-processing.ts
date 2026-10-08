// Compute payslips in integer paise and store monetary results as Decimal128. Use
// half-away-from-zero rounding for earnings and deductions; floor hours shortfall deductions to
// whole rupees.
//
// Working days = P + T + S + LM + 0.5 × HD.
// Payable days also include CO, OH, and WO without requiring punch hours. A scheduled week-off or
// a holiday with no attendance row is counted as WO / OH for an employee who worked that month.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { isScheduledWeekOff, policyFromSettings } from '@/lib/weekly-off-policy';
import { isWorkedStatus } from '@/lib/attendance-status';
import { todayIST } from '@/lib/display-formatting';
import { collections } from '@/lib/db/collection-registry';
import { scopedFor } from '@/lib/db/scoped-repository';
import { systemScope } from '@/lib/db/access-scope';
import { withTransaction } from '@/lib/db/mongodb-connection';
import { fromPaise, toPaise } from '@/lib/db/decimal-conversions';
import { calculatePayslip } from '@/lib/payroll/payslip-calculation';
import { registerFunction } from '@/lib/db/scoped-query-client';
import type { PayslipComputation, PayrollAttendanceDay } from '@/lib/payroll/payslip-calculation';
import type { WeekOffPolicy } from '@/lib/weekly-off-policy';
import type { ClientSession, Document } from 'mongodb';
import type { BaseDoc } from '@/lib/db/collection-registry';

// Month-wide inputs that are the same for every employee in a run.
interface PayrollCalendar {
  policy: WeekOffPolicy;
  // Holiday date -> branch ids it applies to; null means every branch.
  holidays: Array<{ date: string; branchId: string | null }>;
}

async function loadPayrollCalendar(
  periodMonth: string,
  session?: ClientSession,
): Promise<PayrollCalendar> {
  const settings = scopedFor<BaseDoc & { key: string; value: unknown }>(
    collections.settings,
    systemScope,
    session,
  );
  const rows = await settings.find({ key: { $in: ['week_off_weekdays', 'working_saturdays'] } });
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const holidays = await scopedFor<BaseDoc>(collections.holidays, systemScope, session).find({
    holiday_date: { $regex: `^${periodMonth.slice(0, 7)}-` },
  });
  return {
    policy: policyFromSettings(byKey.get('week_off_weekdays'), byKey.get('working_saturdays')),
    holidays: holidays.map((holiday) => ({
      date: String(holiday.holiday_date).slice(0, 10),
      branchId: (holiday.branch_id as string | null) ?? null,
    })),
  };
}

/**
 * Paid days off that have no attendance row. Week-offs and holidays are only stamped by hand or by
 * the Excel import, so a month built from punches has none; without these an employee present on
 * every working day would be paid for the working days alone.
 *
 * Counted only for an employee who worked at least one day that month, only between their joining
 * date and last working day, and never for a day that has not happened yet.
 */
function unrecordedPaidDaysOff(
  periodMonth: string,
  recorded: Array<{ work_date: string; status: string }>,
  employee: {
    branchId: string | null;
    dateOfJoining: string | null;
    lastWorkingDay: string | null;
  },
  calendar: PayrollCalendar,
): PayrollAttendanceDay[] {
  if (!recorded.some((day) => isWorkedStatus(day.status))) {
    return [];
  }
  const recordedDates = new Set(recorded.map((day) => day.work_date));
  const holidayDates = new Set(
    calendar.holidays
      .filter((holiday) => holiday.branchId === null || holiday.branchId === employee.branchId)
      .map((holiday) => holiday.date),
  );
  const [year, month] = periodMonth.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = todayIST();
  const out: PayrollAttendanceDay[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${periodMonth.slice(0, 8)}${String(day).padStart(2, '0')}`;
    if (
      recordedDates.has(date) ||
      date > today ||
      (employee.dateOfJoining !== null && date < employee.dateOfJoining) ||
      (employee.lastWorkingDay !== null && date > employee.lastWorkingDay)
    ) {
      continue;
    }
    if (holidayDates.has(date)) {
      out.push({ status: 'OH', workedMinutes: 0 });
    } else if (isScheduledWeekOff(date, calendar.policy)) {
      out.push({ status: 'WO', workedMinutes: 0 });
    }
  }
  return out;
}

// 'YYYY-MM-DD' from a stored date-only value, or null when it is unset.
function dateOnly(value: unknown): string | null {
  return value ? String(value).slice(0, 10) : null;
}

// Retrieves a numeric configuration setting with a fallback default.
async function settingNumeric(
  key: string,
  fallback: number,
  session?: ClientSession,
): Promise<number> {
  const settings = scopedFor<BaseDoc & { key: string; value: unknown }>(
    collections.settings,
    systemScope,
    session,
  );
  const row = await settings.findOne({ key });
  const n = Number(row?.value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

// Calculates professional tax based on state, gross pay, gender, and month.
// Precedence order: month-specific > gender-specific > highest min_gross threshold.
async function professionalTax(
  state: string | null,
  grossPaise: number,
  gender: string,
  month: number,
  session?: ClientSession,
): Promise<number> {
  if (!state) {
    return 0;
  }
  const slabs = scopedFor<BaseDoc>(collections.ptSlabs, systemScope, session);
  const rows = await slabs.find({ state });

  const matching = rows.filter((s) => {
    if (s.gender != null && String(s.gender).toLowerCase() !== String(gender ?? '').toLowerCase()) {
      return false;
    }
    if (grossPaise < toPaise(s.min_gross as never)) {
      return false;
    }
    if (s.max_gross != null && grossPaise > toPaise(s.max_gross as never)) {
      return false;
    }
    if (s.month != null && s.month !== month) {
      return false;
    }
    return true;
  });

  matching.sort((a, b) => {
    const monthRank = Number(b.month != null) - Number(a.month != null);
    if (monthRank) {
      return monthRank;
    }
    const genderRank = Number(b.gender != null) - Number(a.gender != null);
    if (genderRank) {
      return genderRank;
    }
    return toPaise(b.min_gross as never) - toPaise(a.min_gross as never);
  });

  return matching.length ? toPaise(matching[0].amount as never) : 0;
}

/**
 * Computes earnings, deductions, and net payable amounts for an employee in a payroll run,
 * persisting the resulting draft/recomputed payslip.
 */
async function computePayslip(employeeId: string, runId: string): Promise<PayslipComputation> {
  return withTransaction(
    async (session) => {
      await reserveOpenRun(runId, session);
      return computePayslipInTransaction(employeeId, runId, session);
    },
    { required: true },
  );
}

async function computePayslipInTransaction(
  employeeId: string,
  runId: string,
  session?: ClientSession,
  // Supplied when a whole run is computed, so the calendar is read once.
  sharedCalendar?: PayrollCalendar,
): Promise<PayslipComputation> {
  const employees = scopedFor<BaseDoc>(collections.employees, systemScope, session);
  const runs = scopedFor<BaseDoc>(collections.payrollRuns, systemScope, session);
  const attendance = scopedFor<BaseDoc>(collections.attendanceDays, systemScope, session);
  const branches = scopedFor<BaseDoc>(collections.branches, systemScope, session);

  const e = await employees.findOne({ _id: employeeId });
  if (!e) {
    throw new Error(`computePayslip: no employee ${employeeId}`);
  }
  const run = await runs.findOne({ _id: runId });
  if (!run) {
    throw new Error(`computePayslip: no payroll run ${runId}`);
  }

  const branch = await branches.findOne({ _id: e.branch_id as string });
  const state = (branch?.state as string | null) ?? null;

  const periodMonth = run.period_month as string; // 'YYYY-MM-01'
  const month = Number(periodMonth.slice(5, 7));

  const esicCapPaise = toPaise(await settingNumeric('esic_gross_cap', 21000, session));
  let fullDayMin = await settingNumeric('full_day_minutes', 555, session);
  if (fullDayMin <= 0) {
    // 9h15m
    fullDayMin = 555;
  }

  // attendance for the month
  // Calendar days are strings, so a month is a prefix — no date arithmetic and
  // no timezone to get wrong.
  const prefix = periodMonth.slice(0, 7);
  const days = await attendance.find({
    employee_id: employeeId,
    work_date: { $regex: `^${prefix}-` },
  });
  const calendar = sharedCalendar ?? (await loadPayrollCalendar(periodMonth, session));
  const paidDaysOff = unrecordedPaidDaysOff(
    periodMonth,
    days.map((day) => ({
      work_date: String(day.work_date).slice(0, 10),
      status: day.status as string,
    })),
    {
      branchId: (e.branch_id as string | null) ?? null,
      dateOfJoining: dateOnly(e.date_of_joining),
      lastWorkingDay: dateOnly(e.last_working_day),
    },
    calendar,
  );

  const grossPaise = toPaise(e.gross_monthly as never);
  const pt = await professionalTax(state, grossPaise, e.gender as string, month, session);
  const payslips = scopedFor<BaseDoc>(collections.payslips, systemScope, session);
  const adjustments = scopedFor<BaseDoc>(collections.payslipAdjustments, systemScope, session);
  const existing = await payslips.findOne({ payroll_run_id: runId, employee_id: employeeId });
  // Adjustments share the payslip's primary key and are absent on the first computation.
  const adj = existing ? await adjustments.findOne({ _id: existing._id as string }) : null;
  const result = calculatePayslip({
    periodMonth,
    grossPaise,
    basicPaise: toPaise(e.basic_da as never),
    hraPaise: toPaise(e.hra as never),
    specialAllowancePaise: toPaise(e.special_allowance as never),
    fullDayMinutes: fullDayMin,
    esicCapPaise,
    professionalTaxPaise: pt,
    attendance: [
      ...days.map((day) => ({
        status: day.status as string,
        workedMinutes: Number(day.worked_minutes ?? 0),
      })),
      ...paidDaysOff,
    ],
    advancePaise: toPaise((adj?.advance_recovery as never) ?? 0),
    lossPaise: toPaise((adj?.loss_damage as never) ?? 0),
    lastMonthBalancePaise: toPaise((adj?.last_month_balance as never) ?? 0),
    reimbursementPaise: toPaise((adj?.reimbursement_bonus as never) ?? 0),
    otherDeductionsPaise: toPaise((adj?.other_deductions as never) ?? 0),
    bonusPaise: toPaise((adj?.bonus as never) ?? 0),
  });
  const {
    payable_days: payableDays,
    worked_minutes: workedMinutes,
    target_minutes: targetMinutes,
    shortfall_minutes: shortfallMinutes,
    per_day_rate: perDayRate,
    basic_earned: basicEarned,
    hra_earned: hraEarned,
    special_earned: specialEarned,
    earned_gross: earnedGross,
    shortfall_amount: shortfallAmount,
    pf_employee: pfEmployee,
    esic_employee: esicEmployee,
    esic_employer: esicEmployer,
    net_payable: netPayable,
  } = result;

  const money = {
    payable_days: fromPaise(Math.round(payableDays * 100)),
    per_day_rate: fromPaise(perDayRate),
    basic_earned: fromPaise(basicEarned),
    hra_earned: fromPaise(hraEarned),
    special_earned: fromPaise(specialEarned),
    earned_gross: fromPaise(earnedGross),
    shortfall_amount: fromPaise(shortfallAmount),
    pf_employee: fromPaise(pfEmployee),
    pf_employer: fromPaise(pfEmployee),
    esic_employee: fromPaise(esicEmployee),
    esic_employer: fromPaise(esicEmployer),
    professional_tax: fromPaise(pt),
    net_payable: fromPaise(netPayable),
  };

  const now = new Date();
  if (existing) {
    // Recomputation updates financial amounts while preserving existing status.
    await payslips.updateOne(
      { _id: existing._id as string },
      {
        $set: {
          worked_minutes: workedMinutes,
          target_minutes: targetMinutes,
          shortfall_minutes: shortfallMinutes,
          ...money,
          updated_at: now,
        },
      },
    );
  } else {
    await payslips.insertOne({
      _id: randomUUID(),
      payroll_run_id: runId,
      employee_id: employeeId,
      worked_minutes: workedMinutes,
      target_minutes: targetMinutes,
      shortfall_minutes: shortfallMinutes,
      ...money,
      status: 'draft',
      created_at: now,
      updated_at: now,
    });
  }

  return result;
}

// Run lifecycle state machine: compute -> lock -> mark-paid.
// Mutations on locked or paid runs throw to protect finalized financial records.

type RunStatus = 'draft' | 'in_review' | 'locked' | 'paid';

interface PayrollRunDoc {
  _id: string;
  status: RunStatus;
  calculation_revision?: number;
  drafts_computed_at?: Date | null;
  locked_at?: Date | null;
  paid_at?: Date | null;
}

function runs(session?: ClientSession) {
  return scopedFor<PayrollRunDoc>(collections.payrollRuns, systemScope, session);
}

/** The run's current status, or null when there is no such run. */
async function runStatus(runId: string, session?: ClientSession): Promise<RunStatus | null> {
  const run = await runs(session).findOne({ _id: runId });
  return run?.status ?? null;
}

// Writing the run first makes calculations and locking contend on the same document. The
// transaction retains that reservation until all of its payslip changes commit or roll back.
async function reserveOpenRun(runId: string, session?: ClientSession): Promise<void> {
  const matched = await runs(session).updateOne(
    { _id: runId, status: { $in: ['draft', 'in_review'] } },
    { $inc: { calculation_revision: 1 } },
  );
  if (!matched) {
    throw new Error('Payroll run is locked, paid, or missing. No payroll changes were saved.');
  }
}

/**
 * Recompute every payslip in the run from current attendance, inside the caller's reservation.
 *
 * A payslip is due to anyone who had joined by the end of the month and is either still employed
 * or has attendance in it, so someone deactivated mid-month is still paid for the days they worked.
 * Payslips left over for anyone else, such as a joiner whose first day is after the month, are
 * removed.
 */
async function recomputeRunInTransaction(runId: string, session?: ClientSession): Promise<void> {
  const run = await scopedFor<BaseDoc>(collections.payrollRuns, systemScope, session).findOne({
    _id: runId,
  });
  if (!run) {
    throw new Error(`computeRun: no payroll run ${runId}`);
  }
  const periodMonth = run.period_month as string;
  const prefix = periodMonth.slice(0, 7);
  const [year, month] = periodMonth.split('-').map(Number);
  const monthEnd = `${prefix}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;

  const attended = new Set(
    (
      await scopedFor<BaseDoc>(collections.attendanceDays, systemScope, session).find(
        { work_date: { $regex: `^${prefix}-` } },
        { projection: { employee_id: 1 } },
      )
    ).map((day) => String(day.employee_id)),
  );
  const employees = await scopedFor<BaseDoc>(collections.employees, systemScope, session).find(
    { deleted_at: null },
    { projection: { _id: 1, status: 1, date_of_joining: 1 } },
  );
  const due = employees.filter((employee) => {
    const joined = dateOnly(employee.date_of_joining);
    if (joined !== null && joined > monthEnd) {
      return false;
    }
    return (
      ['active', 'on_notice'].includes(employee.status as string) ||
      attended.has(String(employee._id))
    );
  });

  const calendar = await loadPayrollCalendar(periodMonth, session);
  for (const employee of due) {
    await computePayslipInTransaction(String(employee._id), runId, session, calendar);
  }

  const payslips = scopedFor<BaseDoc>(collections.payslips, systemScope, session);
  const dueIds = new Set(due.map((employee) => String(employee._id)));
  const stale = (await payslips.find({ payroll_run_id: runId }, { projection: { employee_id: 1 } }))
    .filter((slip) => !dueIds.has(String(slip.employee_id)))
    .map((slip) => String(slip._id));
  if (stale.length > 0) {
    await scopedFor<BaseDoc>(collections.payslipAdjustments, systemScope, session).deleteMany({
      _id: { $in: stale },
    });
    await payslips.deleteMany({ _id: { $in: stale } });
  }
}

/** Recompute the complete run atomically so locking cannot freeze a partially updated batch. */
async function computeRun(runId: string): Promise<void> {
  await withTransaction(
    async (session) => {
      await reserveOpenRun(runId, session);
      await recomputeRunInTransaction(runId, session);
      await runs(session).updateOne(
        { _id: runId },
        { $set: { drafts_computed_at: new Date(), status: 'in_review' } },
      );
    },
    { required: true },
  );
}

/**
 * Save adjustments and their calculated amounts under the same run reservation.
 *
 * `reimbursementSeenPaise` is the reimbursement credit the form was showing. Approving a claim adds
 * to that credit from another screen, so a form opened earlier would otherwise write the old figure
 * back and erase the claim.
 */
async function savePayslipAdjustments(
  payslipId: string,
  values: Document,
  reimbursementSeenPaise: number | null = null,
): Promise<void> {
  await withTransaction(
    async (session) => {
      const payslips = scopedFor<BaseDoc>(collections.payslips, systemScope, session);
      const slip = await payslips.findOne({ _id: payslipId });
      if (!slip) {
        throw new Error('That payslip no longer exists.');
      }
      const runId = String(slip.payroll_run_id);
      await reserveOpenRun(runId, session);
      const adjustments = scopedFor<BaseDoc>(collections.payslipAdjustments, systemScope, session);
      if (reimbursementSeenPaise !== null) {
        const current = await adjustments.findOne({ _id: payslipId });
        if (toPaise((current?.reimbursement_bonus as never) ?? 0) !== reimbursementSeenPaise) {
          throw new Error(
            'The reimbursement on this payslip changed after you opened it, most likely because a claim was approved. Reload the page and enter your adjustments again.',
          );
        }
      }
      const now = new Date();
      const doc = { ...values, updated_at: now };
      await adjustments.upsertOne(
        { _id: payslipId },
        { $set: doc, $setOnInsert: { created_at: now } },
        { _id: payslipId, created_at: now, ...doc },
      );
      const result = await computePayslipInTransaction(String(slip.employee_id), runId, session);
      // Throwing rolls the adjustments back with the payslip.
      if (result.net_payable < 0) {
        throw new Error(
          'These deductions are more than the employee earned this month, which would make the net pay negative. Reduce them and carry the remainder to next month.',
        );
      }
    },
    { required: true },
  );
}

/**
 * Freezes a payroll run and marks all associated payslips as 'generated'.
 *
 * Payslips are recomputed first, so attendance corrected since the last "Recompute drafts" is in
 * the figures that get frozen. Executed inside an atomic transaction to ensure payslip states and
 * run lock status transition synchronously.
 */
async function lockRun(runId: string): Promise<void> {
  await withTransaction(
    async (session) => {
      await reserveOpenRun(runId, session);
      await recomputeRunInTransaction(runId, session);

      const now = new Date();
      const payslips = scopedFor<BaseDoc>(collections.payslips, systemScope, session);
      await payslips.updateMany(
        { payroll_run_id: runId },
        { $set: { status: 'generated', updated_at: now } },
      );
      await runs(session).updateOne({ _id: runId }, { $set: { status: 'locked', locked_at: now } });
    },
    { required: true },
  );
}

/**
 * Transitions a locked payroll run and all its payslips to 'paid' status.
 * Requires the run to be in 'locked' status prior to transition.
 */
async function markRunPaid(runId: string): Promise<void> {
  await withTransaction(
    async (session) => {
      const status = await runStatus(runId, session);
      if (status !== 'locked') {
        throw new Error(
          `Payroll run ${runId} must be locked before it can be paid (is ${status ?? 'missing'})`,
        );
      }

      const now = new Date();
      const payslips = scopedFor<BaseDoc>(collections.payslips, systemScope, session);
      await payslips.updateMany(
        { payroll_run_id: runId },
        { $set: { status: 'paid', updated_at: now } },
      );
      await runs(session).updateOne({ _id: runId }, { $set: { status: 'paid', paid_at: now } });
      // Claims credited to these payslips were paid with them. Closing them here stops the same
      // claim being marked paid a second time from the Reimbursements screen.
      await scopedFor<BaseDoc>(collections.reimbursementClaims, systemScope, session).updateMany(
        { payroll_run_id: runId, status: 'approved' },
        {
          $set: { status: 'paid', paid_at: now, payment_ref: 'Paid with payroll', updated_at: now },
        },
      );
    },
    { required: true },
  );
}

let registered = false;

function registerPayrollFunctions(): void {
  if (registered) {
    return;
  }
  registered = true;
  registerFunction('fn_compute_payslip', async (a) => {
    const { p_employee_id, p_run_id } = a as { p_employee_id: string; p_run_id: string };
    await computePayslip(p_employee_id, p_run_id);
    return null;
  });
  registerFunction('fn_compute_run', async (a) => {
    await computeRun((a as { p_run_id: string }).p_run_id);
    return null;
  });
  registerFunction('fn_lock_run', async (a) => {
    await lockRun((a as { p_run_id: string }).p_run_id);
    return null;
  });
  registerFunction('fn_mark_run_paid', async (a) => {
    await markRunPaid((a as { p_run_id: string }).p_run_id);
    return null;
  });
}

export {
  professionalTax,
  computePayslip,
  computeRun,
  savePayslipAdjustments,
  lockRun,
  markRunPaid,
  registerPayrollFunctions,
};

export type { RunStatus, PayslipComputation };
