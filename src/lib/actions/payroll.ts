'use server';

// Payroll run and adjustment actions. The payroll RPC handlers enforce state transitions; pass
// their failures back to the caller.
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { isMongoConfigured } from '@/lib/db/mongo';
import { getSession } from '@/lib/auth';
import { notifyEmployee } from '@/lib/notify';
import { toMoney } from '@/lib/db/money';
import { queryErrorMessage } from '@/lib/db/errors';
import { savePayslipAdjustments } from '@/lib/db/payroll';
import type { Decimal128 } from 'mongodb';
import type { AppRole } from '@/types/database';

// Match guards.ts writeRoles. Payroll writes require super_admin, admin, or hr; portal read access
// is insufficient.
const payrollRoles: readonly AppRole[] = ['super_admin', 'admin', 'hr'];

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
  if (!profile) {
    return { ok: false, error: 'You are not signed in.' };
  }
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
    if (!g.ok) {
      return { ok: false, error: g.error };
    }

    const start = `${periodMonth.slice(0, 7)}-01`;
    const dbc = await createClient();

    const { data: existing, error: existErr } = await dbc
      .from('payroll_runs')
      .select('id')
      .eq('period_month', start)
      .maybeSingle();
    if (existErr) {
      return { ok: false, error: queryErrorMessage(existErr) };
    }
    if (existing) {
      return { ok: false, error: `A payroll run for ${start} already exists.` };
    }

    const { data, error } = await dbc
      .from('payroll_runs')
      .insert({ period_month: start, status: 'draft' })
      .select('id');
    if (error) {
      return { ok: false, error: queryErrorMessage(error) };
    }
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
    if (!runId) {
      return { ok: false, error: `${context}: no payroll run for this month yet.` };
    }

    const g = await gate();
    if (!g.ok) {
      return { ok: false, error: g.error };
    }

    const dbc = await createClient();
    const { error } = await dbc.rpc(fn, { p_run_id: runId });
    if (error) {
      return { ok: false, error: queryErrorMessage(error) };
    }

    revalidatePath('/payroll');
    return { ok: true };
  } catch (e) {
    return caught(context, e);
  }
}

/**
 * Recompute draft payslips for active and on-notice employees and stamp
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
  if (res.ok) {
    await notifyPayslipsReady(runId);
  }
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

    for (const s of (slips ?? []) as Array<{ employee_id: string }>) {
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
  if (!raw) {
    return 0;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return `${moneyLabel[key]} must be a number (got "${raw}").`;
  }
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
    if (!payslipId) {
      return { ok: false, error: `${context}: no payslip selected.` };
    }

    const g = await gate();
    if (!g.ok) {
      return { ok: false, error: g.error };
    }

    const values = {} as Record<MoneyField, number>;
    for (const field of moneyFields) {
      const parsed = money(formData, field);
      if (typeof parsed === 'string') {
        return { ok: false, error: parsed };
      }
      values[field] = parsed;
    }
    const remarksRaw = String(formData.get('remarks') ?? '').trim();

    await savePayslipAdjustments(payslipId, {
      ...(Object.fromEntries(moneyFields.map((field) => [field, toMoney(values[field])])) as Record<
        MoneyField,
        Decimal128
      >),
      remarks: remarksRaw || null,
      updated_by: g.profileId,
    });

    revalidatePath('/payroll');
    return { ok: true };
  } catch (e) {
    return caught(context, e);
  }
}
