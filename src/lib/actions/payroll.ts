'use server';

// Payroll run and adjustment actions. The payroll RPC handlers enforce state transitions; pass
// their failures back to the caller.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { isMongoConfigured } from '@/lib/db/mongo';
import { getSession } from '@/lib/auth';
import { notifyEmployee } from '@/lib/notify';
import type { Decimal128 } from 'mongodb';
import { toMoney } from '@/lib/db/money';
import type { AppRole, PayrollStatus } from '@/types/database';

// Roles allowed to move money. Deliberately NOT `staffRoles` from @/lib/auth: that is the portal
// READ set, and gating on it let a reader through to writes the policy layer then filtered to zero
// rows — a write that reports success and changes nothing. An explicit set turns that into an
// honest, explained refusal. Matches guards.ts writeRoles: super_admin, admin, hr.
const payrollRoles: readonly AppRole[] = ['super_admin', 'admin', 'hr'];

// A run in one of these states is history; recompute/adjust must refuse.
const frozen: readonly PayrollStatus[] = ['locked', 'paid'];

interface PgError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}

// Flatten a query error into one readable line. The summary arrives in `message`; some errors put
// the useful half in `hint`/`details` instead.
function pgMessage(error: PgError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(' — ');
}

type Gate = { ok: true; profileId: string } | { ok: false; error: string };

// Resolve the caller and prove they may run payroll.
async function gate(): Promise<Gate> {
  if (!isMongoConfigured()) {
    return {
      ok: false,
      error: 'The database is not configured, so payroll cannot run.',
    };
  }

  const { profile } = await getSession();
  if (!profile) return { ok: false, error: 'You are not signed in.' };
  if (!payrollRoles.includes(profile.role)) {
    return {
      ok: false,
      error: `Payroll actions need an admin or HR account — yours is "${profile.role}".`,
    };
  }
  return { ok: true, profileId: profile.id };
}

// Turn a thrown error (getSession, network, …) into a returned one.
function caught(context: string, e: unknown): { ok: false; error: string } {
  const message = e instanceof Error ? e.message : String(e);
  return { ok: false, error: `${context}: ${message}` };
}

// run actions

/**
 * Creates a new payroll run in 'draft' status for the specified period month (YYYY-MM-01).
 * Working days and target minutes are computed per-employee during the compute stage.
 */
export async function openRun(periodMonth: string): Promise<{ ok: boolean; error?: string }> {
  const context = 'Start payroll run';
  try {
    const g = await gate();
    if (!g.ok) return { ok: false, error: g.error };

    const start = `${periodMonth.slice(0, 7)}-01`;
    const dbc = await createClient();

    const { data: existing, error: existErr } = await dbc
      .from('payroll_runs')
      .select('id')
      .eq('period_month', start)
      .maybeSingle();
    if (existErr) return { ok: false, error: pgMessage(existErr) };
    if (existing) return { ok: false, error: `A payroll run for ${start} already exists.` };

    const { data, error } = await dbc
      .from('payroll_runs')
      .insert({ period_month: start, status: 'draft' })
      .select('id');
    if (error) return { ok: false, error: pgMessage(error) };
    if (!data || data.length === 0) {
      return {
        ok: false,
        error: `${context}: no run was created — your role may lack permission.`,
      };
    }

    revalidatePath('/payroll');
    return { ok: true };
  } catch (e) {
    return caught(context, e);
  }
}

type RunRpc = 'fn_compute_run' | 'fn_lock_run' | 'fn_mark_run_paid';

/** Shared body for the three run-level RPCs — they differ only by name. */
async function callRunRpc(
  fn: RunRpc,
  runId: string,
  context: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!runId) return { ok: false, error: `${context}: no payroll run for this month yet.` };

    const g = await gate();
    if (!g.ok) return { ok: false, error: g.error };

    const dbc = await createClient();
    const { error } = await dbc.rpc(fn, { p_run_id: runId });
    if (error) return { ok: false, error: pgMessage(error) };

    revalidatePath('/payroll');
    return { ok: true };
  } catch (e) {
    return caught(context, e);
  }
}

/**
 * Recompute every active employee's draft payslip for the run and stamp
 * drafts_computed_at. Raises (and therefore returns ok:false) on a locked run.
 */
export async function computeRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  return callRunRpc('fn_compute_run', runId, 'Recompute drafts');
}

/** Freeze the run and mark its payslips generated. Irreversible. */
export async function lockRun(runId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await callRunRpc('fn_lock_run', runId, 'Lock run');
  // Locking is the moment payslips become final, so tell each employee theirs
  // is ready. Best-effort: a notification failure never un-locks the run.
  if (res.ok) await notifyPayslipsReady(runId);
  return res;
}

/** Notify every employee who has a payslip in this run. */
async function notifyPayslipsReady(runId: string): Promise<void> {
  try {
    const dbc = await createClient();
    const { data: run } = await dbc
      .from('payroll_runs')
      .select('period_month')
      .eq('id', runId)
      .maybeSingle<{ period_month: string }>();
    const { data: slips } = await dbc
      .from('payslips')
      .select('employee_id')
      .eq('payroll_run_id', runId);

    const month = run?.period_month
      ? new Date(`${String(run.period_month).slice(0, 7)}-01T00:00:00Z`).toLocaleDateString(
          'en-GB',
          { month: 'long', year: 'numeric', timeZone: 'UTC' },
        )
      : 'this month';

    for (const s of (slips ?? []) as { employee_id: string }[]) {
      await notifyEmployee(s.employee_id, {
        kind: 'payroll',
        title: `Your ${month} payslip is ready`,
        body: 'Open your dashboard to view or download it.',
        link: '/me#payslips',
      });
    }
  } catch {
    // Best-effort only — the run is already locked.
  }
}

/** Mark a locked run (and its payslips) paid. */
export async function markRunPaid(runId: string): Promise<{ ok: boolean; error?: string }> {
  return callRunRpc('fn_mark_run_paid', runId, 'Mark run paid');
}

// adjustments

const moneyFields = [
  'advance_recovery',
  'bonus',
  'loss_damage',
  'other_deductions',
  'last_month_balance',
  'reimbursement_bonus',
] as const;

type MoneyField = (typeof moneyFields)[number];

const moneyLabel: Record<MoneyField, string> = {
  advance_recovery: 'Advance recovery',
  bonus: 'Bonus',
  loss_damage: 'Late marks / Loss & damage',
  other_deductions: 'Other deductions',
  last_month_balance: 'Last month balance',
  reimbursement_bonus: 'Reimbursement',
};

/**
 * Parse a rupee field. Blank means zero; anything unparseable is a user error,
 * not a silent zero — writing 0 because someone typed "5oo" would quietly
 * change their pay.
 */
function money(formData: FormData, key: MoneyField): number | string {
  const raw = String(formData.get(key) ?? '')
    .trim()
    .replace(/[,\s₹]/g, '');
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${moneyLabel[key]} must be a number (got "${raw}").`;
  // Round to paise (2 decimal places).
  return Math.round(n * 100) / 100;
}

/**
 * Save one payslip's manual adjustments, then recompute that payslip so
 * net_payable reflects them — the payslip computation reads this collection.
 *
 * Expects: payslipId, advance_recovery, loss_damage, last_month_balance,
 * reimbursement_bonus, remarks.
 */
export async function saveAdjustments(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const context = 'Save adjustments';
  try {
    const payslipId = String(formData.get('payslipId') ?? '').trim();
    if (!payslipId) return { ok: false, error: `${context}: no payslip selected.` };

    const g = await gate();
    if (!g.ok) return { ok: false, error: g.error };

    const values = {} as Record<MoneyField, number>;
    for (const field of moneyFields) {
      const parsed = money(formData, field);
      if (typeof parsed === 'string') return { ok: false, error: parsed };
      values[field] = parsed;
    }
    const remarksRaw = String(formData.get('remarks') ?? '').trim();

    const dbc = await createClient();

    // Which employee/run does this payslip belong to?
    const { data: payslip, error: lookupError } = await dbc
      .from('payslips')
      .select('id, employee_id, payroll_run_id')
      .eq('id', payslipId)
      .maybeSingle<{ id: string; employee_id: string; payroll_run_id: string }>();
    if (lookupError) return { ok: false, error: `${context}: ${pgMessage(lookupError)}` };
    if (!payslip) {
      return { ok: false, error: `${context}: payslip ${payslipId} no longer exists.` };
    }

    const employeeId = payslip.employee_id;
    const runId = payslip.payroll_run_id;

    // Fail-closed verification: ensure payroll run is in 'draft' or 'in_review' status before recomputing.
    const { data: run, error: runError } = await dbc
      .from('payroll_runs')
      .select('status')
      .eq('id', runId)
      .maybeSingle<{ status: PayrollStatus }>();
    if (runError) {
      return {
        ok: false,
        error: `${context}: could not check whether this payroll run is locked: ${pgMessage(runError)}`,
      };
    }
    if (!run?.status) {
      return {
        ok: false,
        error:
          `${context}: payslip ${payslipId} points at payroll run ${runId}, which could not be ` +
          `read, so there is no way to tell whether it is locked. Refusing to write.`,
      };
    }
    if (frozen.includes(run.status)) {
      return {
        ok: false,
        error: `${context}: this payroll run is ${run.status} — adjustments are frozen and cannot be changed.`,
      };
    }

    const { error: upsertError } = await dbc.from('payslip_adjustments').upsert(
      {
        id: payslipId,
        // Parsed as numbers above so the range checks read naturally, then
        // converted on the way out: every adjustment column is `decimal`, and
        // a JS number is rejected by the validator.
        ...(Object.fromEntries(
          moneyFields.map((field) => [field, toMoney(values[field])]),
        ) as Record<MoneyField, Decimal128>),
        remarks: remarksRaw || null,
        updated_by: g.profileId,
        updated_at: new Date(),
      },
      { onConflict: 'id' },
    );
    if (upsertError) return { ok: false, error: `${context}: ${pgMessage(upsertError)}` };

    // Recompute so the row the user is looking at tells the truth.
    const { error: recomputeError } = await dbc.rpc('fn_compute_payslip', {
      p_employee_id: employeeId,
      p_run_id: runId,
    });
    if (recomputeError) {
      // The upsert above DID land. Revalidate even on this failure path, or the
      // cached page keeps serving the old adjustments while the database holds
      // the new ones — the reader would have no way to know their edit stuck.
      revalidatePath('/payroll');
      return {
        ok: false,
        error:
          `${context}: adjustments were saved, but recomputing the payslip failed, so the ` +
          `net payable shown is stale: ${pgMessage(recomputeError)}`,
      };
    }

    revalidatePath('/payroll');
    return { ok: true };
  } catch (e) {
    return caught(context, e);
  }
}
