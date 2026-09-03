// ============================================================================
// Payslip computation. SERVER ONLY.
//
// This is the highest-risk file in the codebase: it decides what lands in
// someone's bank account. It began as a line-by-line port of a plpgsql
// function, which was then the specification. That SQL has been deleted, so
// this file is now the specification — the rules it encodes are stated in the
// comments below and in the README's payroll section, and they should be
// changed only together.
//
// THE ARITHMETIC RULE
//
// Every money value is handled in integer PAISE (lib/db/money.ts) and converted
// to Decimal128 only when written. Postgres numeric is exact; a float64 is not,
// and a payroll run is thousands of operations. Two rounding behaviours are
// carried over deliberately because they change the figures:
//
//   * round(x, n) in Postgres rounds HALF AWAY FROM ZERO. JavaScript's
//     Math.round rounds half UP, which differs for negatives — a deduction of
//     -0.5 becomes -0 instead of -1 and never reconciles. scalePaise() handles
//     this; nothing here calls Math.round on money directly.
//
//   * The shortfall uses floor(), NOT round(). The comment in the SQL is
//     explicit that this matches the company register ("DN002: 21, not 22").
//     Rounding it would overcharge every under-worked employee by up to a rupee.
//
// THE FORMULA, from the register the company already runs on:
//   working days (col AP) = P + CO + OH + T + S + LM + 0.5 x HD
//   payable days (col AQ) = working days + WO        (week-offs ARE paid)
//   Leave (L) is NOT payable and is excluded on purpose.
// ============================================================================
import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import { COLLECTIONS, type BaseDoc } from '@/lib/db/collections';
import { scopedFor } from '@/lib/db/repo';
import { SYSTEM_SCOPE } from '@/lib/db/scope';
import { withTransaction } from '@/lib/db/mongo';
import { addPaise, fromPaise, roundToRupee, scalePaise, subPaise, toPaise } from '@/lib/db/money';
import { registerRpc } from '@/lib/db/pgcompat';

/** Statuses counted as a full working day. */
const FULL_DAY = ['P', 'CO', 'OH', 'T', 'S', 'LM'];

/** A numeric setting with a default. Replaces fn_setting_numeric(). */
async function settingNumeric(key: string, fallback: number): Promise<number> {
  const settings = scopedFor<BaseDoc & { key: string; value: unknown }>(COLLECTIONS.settings, SYSTEM_SCOPE);
  const row = await settings.findOne({ key });
  const n = Number(row?.value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

/** Days in the month a 'YYYY-MM-01' period refers to. */
function daysInMonth(periodMonth: string): number {
  const [y, m] = periodMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * fn_professional_tax — the slab matching state, gross, gender and month.
 *
 * The ordering is load-bearing and is copied exactly: a month-specific slab
 * beats a general one, a gender-specific slab beats a general one, and the
 * highest matching min_gross wins. Getting that order wrong silently picks a
 * different slab and quietly changes everyone's PT.
 */
export async function professionalTax(
  state: string | null,
  grossPaise: number,
  gender: string,
  month: number,
): Promise<number> {
  if (!state) return 0;
  const slabs = scopedFor<BaseDoc>(COLLECTIONS.ptSlabs, SYSTEM_SCOPE);
  const rows = await slabs.find({ state });

  const matching = rows.filter((s) => {
    if (s.gender != null && s.gender !== gender) return false;
    if (grossPaise < toPaise(s.min_gross as never)) return false;
    if (s.max_gross != null && grossPaise > toPaise(s.max_gross as never)) return false;
    if (s.month != null && s.month !== month) return false;
    return true;
  });

  matching.sort((a, b) => {
    const monthRank = Number(b.month != null) - Number(a.month != null);
    if (monthRank) return monthRank;
    const genderRank = Number(b.gender != null) - Number(a.gender != null);
    if (genderRank) return genderRank;
    return toPaise(b.min_gross as never) - toPaise(a.min_gross as never);
  });

  return matching.length ? toPaise(matching[0].amount as never) : 0;
}

export interface PayslipComputation {
  payable_days: number;
  worked_minutes: number;
  target_minutes: number;
  shortfall_minutes: number;
  /** All amounts in paise; converted to Decimal128 on write. */
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
 * Compute one payslip and upsert it. Mirrors fn_compute_payslip(employee, run).
 *
 * Returns the computed figures so a caller can diff them against the SQL
 * version before trusting the port on a real month.
 */
export async function computePayslip(
  employeeId: string,
  runId: string,
  session?: ClientSession,
): Promise<PayslipComputation> {
  const employees = scopedFor<BaseDoc>(COLLECTIONS.employees, SYSTEM_SCOPE, session);
  const runs = scopedFor<BaseDoc>(COLLECTIONS.payrollRuns, SYSTEM_SCOPE, session);
  const attendance = scopedFor<BaseDoc>(COLLECTIONS.attendanceDays, SYSTEM_SCOPE, session);
  const branches = scopedFor<BaseDoc>(COLLECTIONS.branches, SYSTEM_SCOPE, session);

  const e = await employees.findOne({ _id: employeeId });
  if (!e) throw new Error(`computePayslip: no employee ${employeeId}`);
  const run = await runs.findOne({ _id: runId });
  if (!run) throw new Error(`computePayslip: no payroll run ${runId}`);

  const branch = await branches.findOne({ _id: e.branch_id as string });
  const state = (branch?.state as string | null) ?? null;

  const periodMonth = run.period_month as string;          // 'YYYY-MM-01'
  const month = Number(periodMonth.slice(5, 7));
  const dim = daysInMonth(periodMonth);

  const esicCapPaise = toPaise(await settingNumeric('esic_gross_cap', 21000));
  let fullDayMin = await settingNumeric('full_day_minutes', 555);
  if (fullDayMin <= 0) fullDayMin = 555;                    // 9h15m

  // --- attendance for the month -------------------------------------------
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
    if (FULL_DAY.includes(status)) workingDays += 1;
    else if (status === 'HD') workingDays += 0.5;
    else if (status === 'WO') weekOffs += 1;
    workedMinutes += Number(d.worked_minutes ?? 0);
  }

  const payableDays = workingDays + weekOffs;

  // Per-EMPLOYEE target: the days they were actually scheduled to work.
  const targetMinutes = Math.round(workingDays * fullDayMin);

  // --- earnings, pro-rated on days in month --------------------------------
  const grossPaise = toPaise(e.gross_monthly as never);
  const perDayRate = scalePaise(e.gross_monthly as never, 1 / dim);
  const basicEarned = scalePaise(e.basic_da as never, payableDays / dim);
  const hraEarned = scalePaise(e.hra as never, payableDays / dim);
  const specialEarned = scalePaise(e.special_allowance as never, payableDays / dim);
  const earnedGross = basicEarned + hraEarned + specialEarned;

  // --- shortfall ------------------------------------------------------------
  let shortfallMinutes = 0;
  let shortfallAmount = 0;
  if (targetMinutes > 0 && workedMinutes < targetMinutes) {
    shortfallMinutes = targetMinutes - workedMinutes;
    // floor() TO THE RUPEE, not to the paisa — see the header.
    //
    // The SQL evaluated this expression on a numeric denominated in RUPEES, so
    // floor() dropped the fraction of a rupee. perDayRate here is in paise, so
    // a bare Math.floor() drops the fraction of a PAISA instead, which is very
    // nearly no rounding at all: at ₹1,000/day, 555 full-day minutes and 137
    // short, the register says ₹246 and this said ₹246.84. Every under-worked
    // employee's deduction disagreed with the register by up to ₹0.99 — on the
    // one figure this file's header singles out as deliberately floored.
    shortfallAmount = Math.floor((perDayRate / fullDayMin) * shortfallMinutes / 100) * 100;
  }

  // --- statutory deductions -------------------------------------------------
  // round(x, 0) — PF and ESIC are whole rupees, so round to 100 paise.
  // roundToRupee(), NOT Math.round: Postgres rounds half AWAY FROM ZERO, and
  // the difference lands on a negative net payable. See money.ts.
  const toRupee = roundToRupee;

  const pfEmployee = toRupee(scalePaise(fromPaise(basicEarned), 0.12));
  let esicEmployee = 0;
  let esicEmployer = 0;
  if (grossPaise <= esicCapPaise) {
    esicEmployee = toRupee(scalePaise(fromPaise(earnedGross), 0.0075));
    esicEmployer = toRupee(scalePaise(fromPaise(earnedGross), 0.0325));
  }

  const pt = await professionalTax(state, grossPaise, e.gender as string, month);

  // --- adjustments ----------------------------------------------------------
  const payslips = scopedFor<BaseDoc>(COLLECTIONS.payslips, SYSTEM_SCOPE, session);
  const adjustments = scopedFor<BaseDoc>(COLLECTIONS.payslipAdjustments, SYSTEM_SCOPE, session);

  const existing = await payslips.findOne({ payroll_run_id: runId, employee_id: employeeId });
  // payslip_adjustments is keyed BY THE PAYSLIP ID (`where id = v_slip_id`),
  // not by a separate column — so there are no adjustments until a payslip
  // exists, which is why a first run never has them and a recompute does.
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
    // pf_employer mirrors pf_employee in the SQL — both are `v_pf`.
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
    // `on conflict ... do update` — a recompute overwrites the figures but
    // leaves status alone, so a locked or paid run is not silently reopened.
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

// ---------------------------------------------------------------------------
// Run-level state machine — compute, lock, mark-paid.
//
// The guards are the point. A locked or paid run is history: recomputing it
// would silently rewrite payslips that have already been issued. That is a
// thrown Error, which pgcompat's rpc() turns back into `{ error }` — the shape
// callRunRpc already branches on, so the refusal reaches the user as a message
// instead of corrupting the run.
// ---------------------------------------------------------------------------

type RunStatus = 'draft' | 'in_review' | 'locked' | 'paid';

interface PayrollRunDoc extends BaseDoc {
  status: RunStatus;
  drafts_computed_at?: Date | null;
  locked_at?: Date | null;
  paid_at?: Date | null;
}

function runs(session?: ClientSession) {
  return scopedFor<PayrollRunDoc>(COLLECTIONS.payrollRuns, SYSTEM_SCOPE, session);
}

/** The run's current status, or null when there is no such run. */
async function runStatus(runId: string, session?: ClientSession): Promise<RunStatus | null> {
  const run = await runs(session).findOne({ _id: runId });
  return run?.status ?? null;
}

/**
 * fn_compute_run — recompute every active employee's payslip for the run.
 *
 * Draft and in_review may be recomputed; locked and paid may not.
 *
 * NOT one transaction, unlike lockRun and markRunPaid below, and the ordering
 * is what makes that safe rather than an oversight. Each payslip is a single
 * document write, atomic on its own, and the run's status is flipped LAST — so
 * an interruption anywhere in the loop leaves the run in draft or in_review
 * with some payslips recomputed, which is precisely the state a recompute is
 * allowed and designed to be run against. Nothing is issued and nothing is
 * frozen until lockRun.
 *
 * Wrapping the loop instead would put an unbounded number of employees inside
 * one transaction, where it would hit the 60-second lifetime limit and abort
 * the entire run — trading a recoverable partial recompute for a payroll that
 * cannot be computed at all.
 */
export async function computeRun(runId: string): Promise<void> {
  const status = await runStatus(runId);
  if (status === null) throw new Error(`Payroll run ${runId} does not exist`);
  if (status === 'locked' || status === 'paid') {
    throw new Error(`Payroll run ${runId} is ${status} — recompute is not allowed after lock`);
  }

  const employees = scopedFor<BaseDoc & { status: string }>(COLLECTIONS.employees, SYSTEM_SCOPE);
  const active = await employees.find({ status: 'active' }, { projection: { _id: 1 } });
  for (const employee of active) {
    await computePayslip(String(employee._id), runId);
  }

  // `status = case when status = 'draft' then 'in_review' else status end` —
  // an in_review run stays in_review rather than being pushed forward again.
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
 * fn_lock_run — freeze the run and mark its payslips generated.
 *
 * TRANSACTIONAL, and this is the case mongo.ts names when it explains why
 * withTransaction exists. Two writes have to land together: the payslips going
 * to 'generated' and the run going to 'locked'. Between them, a dropped
 * connection or a process restart used to leave N payslips marked generated on
 * a run still sitting in 'in_review' — a state computeRun accepts, so the next
 * recompute would silently rewrite the figures on payslips that had already
 * been issued. The status read joins the transaction too, so the guard cannot
 * be decided on a run that another caller locks a moment later.
 */
export async function lockRun(runId: string): Promise<void> {
  await withTransaction(async (session) => {
    const status = await runStatus(runId, session);
    if (status === null) throw new Error(`Payroll run ${runId} does not exist`);
    if (status === 'locked' || status === 'paid') {
      throw new Error(`Payroll run ${runId} is already ${status}`);
    }

    const now = new Date();
    const payslips = scopedFor<BaseDoc>(COLLECTIONS.payslips, SYSTEM_SCOPE, session);
    await payslips.updateMany(
      { payroll_run_id: runId },
      { $set: { status: 'generated', updated_at: now } },
    );
    await runs(session).updateOne(
      { _id: runId },
      { $set: { status: 'locked', locked_at: now } },
    );
  });
}

/**
 * fn_mark_run_paid — a run must be locked before it can be paid.
 *
 * Transactional for the same reason as lockRun: payslips marked paid on a run
 * that is not is a discrepancy nothing downstream would ever reconcile.
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
    const payslips = scopedFor<BaseDoc>(COLLECTIONS.payslips, SYSTEM_SCOPE, session);
    await payslips.updateMany(
      { payroll_run_id: runId },
      { $set: { status: 'paid', updated_at: now } },
    );
    await runs(session).updateOne({ _id: runId }, { $set: { status: 'paid', paid_at: now } });
  });
}

let registered = false;

export function registerPayrollFunctions(): void {
  if (registered) return;
  registered = true;
  registerRpc('fn_compute_payslip', async (a) => {
    const { p_employee_id, p_run_id } = a as { p_employee_id: string; p_run_id: string };
    await computePayslip(p_employee_id, p_run_id);
    return null; // the SQL returned void
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
