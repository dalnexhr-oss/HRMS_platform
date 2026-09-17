// Compute payslips in integer paise and store monetary results as Decimal128. Use
// half-away-from-zero rounding for earnings and deductions; floor hours shortfall deductions to
// whole rupees.
//
// Working days = P + CO + OH + T + S + LM + 0.5 × HD.
// Payable days = working days + WO; unpaid leave is excluded.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { collections } from '@/lib/db/collections';
import { scopedFor } from '@/lib/db/repo';
import { systemScope } from '@/lib/db/scope';
import { withTransaction } from '@/lib/db/mongo';
import { addPaise, fromPaise, roundToRupee, scalePaise, subPaise, toPaise } from '@/lib/db/money';
import { registerRpc } from '@/lib/db/query-client';
import type { ClientSession } from 'mongodb';
import type { BaseDoc } from '@/lib/db/collections';

// Statuses counted as a full working day.
const fullDay = ['P', 'CO', 'OH', 'T', 'S', 'LM'];

// Retrieves a numeric configuration setting with a fallback default.
async function settingNumeric(key: string, fallback: number): Promise<number> {
  const settings = scopedFor<BaseDoc & { key: string; value: unknown }>(
    collections.settings,
    systemScope,
  );
  const row = await settings.findOne({ key });
  const n = Number(row?.value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

// Days in the month a 'YYYY-MM-01' period refers to.
function daysInMonth(periodMonth: string): number {
  const [y, m] = periodMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Calculates professional tax based on state, gross pay, gender, and month.
// Precedence order: month-specific > gender-specific > highest min_gross threshold.
export async function professionalTax(
  state: string | null,
  grossPaise: number,
  gender: string,
  month: number,
): Promise<number> {
  if (!state) {
    return 0;
  }
  const slabs = scopedFor<BaseDoc>(collections.ptSlabs, systemScope);
  const rows = await slabs.find({ state });

  const matching = rows.filter((s) => {
    if (s.gender != null && s.gender !== gender) {
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

export interface PayslipComputation {
  payable_days: number;
  worked_minutes: number;
  target_minutes: number;
  shortfall_minutes: number;
  // All amounts in paise; converted to Decimal128 on write.
  per_day_rate: number;
  basic_earned: number;
  hra_earned: number;
  special_earned: number;
  earned_gross: number;
  shortfall_amount: number;
  pf_employee: number;
  pf_employer: number;
  esic_employee: number;
  esic_employer: number;
  professional_tax: number;
  net_payable: number;
}

/**
 * Computes earnings, deductions, and net payable amounts for an employee in a payroll run,
 * persisting the resulting draft/recomputed payslip.
 */
export async function computePayslip(
  employeeId: string,
  runId: string,
  session?: ClientSession,
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
  const dim = daysInMonth(periodMonth);

  const esicCapPaise = toPaise(await settingNumeric('esic_gross_cap', 21000));
  let fullDayMin = await settingNumeric('full_day_minutes', 555);
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

  let workingDays = 0;
  let weekOffs = 0;
  let workedMinutes = 0;
  for (const d of days) {
    const status = d.status as string;
    if (fullDay.includes(status)) {
      workingDays += 1;
    } else if (status === 'HD') {
      workingDays += 0.5;
    } else if (status === 'WO') {
      weekOffs += 1;
    }
    workedMinutes += Number(d.worked_minutes ?? 0);
  }

  const payableDays = workingDays + weekOffs;

  // Per-EMPLOYEE target: the days they were actually scheduled to work.
  const targetMinutes = Math.round(workingDays * fullDayMin);

  // earnings, pro-rated on days in month
  const grossPaise = toPaise(e.gross_monthly as never);
  const perDayRate = scalePaise(e.gross_monthly as never, 1 / dim);
  const basicEarned = scalePaise(e.basic_da as never, payableDays / dim);
  const hraEarned = scalePaise(e.hra as never, payableDays / dim);
  const specialEarned = scalePaise(e.special_allowance as never, payableDays / dim);
  const earnedGross = basicEarned + hraEarned + specialEarned;

  // shortfall
  let shortfallMinutes = 0;
  let shortfallAmount = 0;
  if (targetMinutes > 0 && workedMinutes < targetMinutes) {
    shortfallMinutes = targetMinutes - workedMinutes;
    // Floor shortfall deduction to whole rupees (100 paise) per payroll specification.
    shortfallAmount = Math.floor(((perDayRate / fullDayMin) * shortfallMinutes) / 100) * 100;
  }

  // statutory deductions
  // PF and ESIC round half away from zero to whole rupees (100 paise multiples).
  const toRupee = roundToRupee;

  const pfEmployee = toRupee(scalePaise(fromPaise(basicEarned), 0.12));
  let esicEmployee = 0;
  let esicEmployer = 0;
  if (grossPaise <= esicCapPaise) {
    esicEmployee = toRupee(scalePaise(fromPaise(earnedGross), 0.0075));
    esicEmployer = toRupee(scalePaise(fromPaise(earnedGross), 0.0325));
  }

  const pt = await professionalTax(state, grossPaise, e.gender as string, month);

  // adjustments
  const payslips = scopedFor<BaseDoc>(collections.payslips, systemScope, session);
  const adjustments = scopedFor<BaseDoc>(collections.payslipAdjustments, systemScope, session);

  const existing = await payslips.findOne({ payroll_run_id: runId, employee_id: employeeId });
  // payslip_adjustments shares primary key with the payslip record; absent on initial run.
  const adj = existing ? await adjustments.findOne({ _id: existing._id as string }) : null;

  const advance = toPaise((adj?.advance_recovery as never) ?? 0);
  const loss = toPaise((adj?.loss_damage as never) ?? 0);
  const lastMonth = toPaise((adj?.last_month_balance as never) ?? 0);
  const reimbursement = toPaise((adj?.reimbursement_bonus as never) ?? 0);
  const other = toPaise((adj?.other_deductions as never) ?? 0);
  const bonus = toPaise((adj?.bonus as never) ?? 0);

  const netRaw = addPaise(
    fromPaise(
      subPaise(
        fromPaise(earnedGross),
        fromPaise(shortfallAmount),
        fromPaise(pfEmployee),
        fromPaise(esicEmployee),
        fromPaise(pt),
        fromPaise(advance),
        fromPaise(loss),
        fromPaise(other),
      ),
    ),
    fromPaise(lastMonth),
    fromPaise(reimbursement),
    fromPaise(bonus),
  );
  // round(..., 0) — the net is paid in whole rupees.
  const netPayable = toRupee(netRaw);

  const result: PayslipComputation = {
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
    // Statutory employer PF contribution matches employee contribution.
    pf_employer: pfEmployee,
    esic_employee: esicEmployee,
    esic_employer: esicEmployer,
    professional_tax: pt,
    net_payable: netPayable,
  };

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

interface PayrollRunDoc extends BaseDoc {
  status: RunStatus;
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

/**
 * Recompute draft or in-review payslips individually to avoid one unbounded transaction. Change
 * run status last so partial failures remain retryable.
 */
export async function computeRun(runId: string): Promise<void> {
  const status = await runStatus(runId);
  if (status === null) {
    throw new Error(`Payroll run ${runId} does not exist`);
  }
  if (status === 'locked' || status === 'paid') {
    throw new Error(`Payroll run ${runId} is ${status} — recompute is not allowed after lock`);
  }

  const employees = scopedFor<BaseDoc & { status: string }>(collections.employees, systemScope);
  const active = await employees.find({ status: 'active' }, { projection: { _id: 1 } });
  for (const employee of active) {
    await computePayslip(String(employee._id), runId);
  }

  // Advance draft runs to in_review; maintain in_review state if already set.
  await runs().updateOne(
    { _id: runId },
    {
      $set: {
        drafts_computed_at: new Date(),
        ...(status === 'draft' ? { status: 'in_review' as RunStatus } : {}),
      },
    },
  );
}

/**
 * Freezes a payroll run and marks all associated payslips as 'generated'.
 *
 * Executed inside an atomic transaction to ensure payslip states and run lock
 * status transition synchronously.
 */
export async function lockRun(runId: string): Promise<void> {
  await withTransaction(async (session) => {
    const status = await runStatus(runId, session);
    if (status === null) {
      throw new Error(`Payroll run ${runId} does not exist`);
    }
    if (status === 'locked' || status === 'paid') {
      throw new Error(`Payroll run ${runId} is already ${status}`);
    }

    const now = new Date();
    const payslips = scopedFor<BaseDoc>(collections.payslips, systemScope, session);
    await payslips.updateMany(
      { payroll_run_id: runId },
      { $set: { status: 'generated', updated_at: now } },
    );
    await runs(session).updateOne({ _id: runId }, { $set: { status: 'locked', locked_at: now } });
  });
}

/**
 * Transitions a locked payroll run and all its payslips to 'paid' status.
 * Requires the run to be in 'locked' status prior to transition.
 */
export async function markRunPaid(runId: string): Promise<void> {
  await withTransaction(async (session) => {
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
  });
}

let registered = false;

export function registerPayrollFunctions(): void {
  if (registered) {
    return;
  }
  registered = true;
  registerRpc('fn_compute_payslip', async (a) => {
    const { p_employee_id, p_run_id } = a as { p_employee_id: string; p_run_id: string };
    await computePayslip(p_employee_id, p_run_id);
    return null;
  });
  registerRpc('fn_compute_run', async (a) => {
    await computeRun((a as { p_run_id: string }).p_run_id);
    return null;
  });
  registerRpc('fn_lock_run', async (a) => {
    await lockRun((a as { p_run_id: string }).p_run_id);
    return null;
  });
  registerRpc('fn_mark_run_paid', async (a) => {
    await markRunPaid((a as { p_run_id: string }).p_run_id);
    return null;
  });
}
