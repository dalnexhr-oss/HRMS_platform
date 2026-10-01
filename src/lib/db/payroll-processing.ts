// Compute payslips in integer paise and store monetary results as Decimal128. Use
// half-away-from-zero rounding for earnings and deductions; floor hours shortfall deductions to
// whole rupees.
//
// Working days = P + T + S + LM + 0.5 × HD.
// Payable days also include CO, OH, and WO without requiring punch hours.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { collections } from '@/lib/db/collection-registry';
import { scopedFor } from '@/lib/db/scoped-repository';
import { systemScope } from '@/lib/db/access-scope';
import { withTransaction } from '@/lib/db/mongodb-connection';
import { fromPaise, toPaise } from '@/lib/db/decimal-conversions';
import { calculatePayslip } from '@/lib/payroll/payslip-calculation';
import { registerRpc } from '@/lib/db/scoped-query-client';
import type { PayslipComputation } from '@/lib/payroll/payslip-calculation';
import type { ClientSession, Document } from 'mongodb';
import type { BaseDoc } from '@/lib/db/collection-registry';

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
    attendance: days.map((day) => ({
      status: day.status as string,
      workedMinutes: Number(day.worked_minutes ?? 0),
    })),
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

/** Recompute the complete run atomically so locking cannot freeze a partially updated batch. */
async function computeRun(runId: string): Promise<void> {
  await withTransaction(
    async (session) => {
      await reserveOpenRun(runId, session);
      const employees = scopedFor<BaseDoc>(collections.employees, systemScope, session);
      const active = await employees.find(
        { status: { $in: ['active', 'on_notice'] } },
        { projection: { _id: 1 } },
      );
      for (const employee of active) {
        await computePayslipInTransaction(String(employee._id), runId, session);
      }
      await runs(session).updateOne(
        { _id: runId },
        { $set: { drafts_computed_at: new Date(), status: 'in_review' } },
      );
    },
    { required: true },
  );
}

/** Save adjustments and their calculated amounts under the same run reservation. */
async function savePayslipAdjustments(payslipId: string, values: Document): Promise<void> {
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
      const now = new Date();
      const doc = { ...values, updated_at: now };
      await adjustments.upsertOne(
        { _id: payslipId },
        { $set: doc, $setOnInsert: { created_at: now } },
        { _id: payslipId, created_at: now, ...doc },
      );
      await computePayslipInTransaction(String(slip.employee_id), runId, session);
    },
    { required: true },
  );
}

/**
 * Freezes a payroll run and marks all associated payslips as 'generated'.
 *
 * Executed inside an atomic transaction to ensure payslip states and run lock
 * status transition synchronously.
 */
async function lockRun(runId: string): Promise<void> {
  await withTransaction(
    async (session) => {
      await reserveOpenRun(runId, session);

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
