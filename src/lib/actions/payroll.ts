'use server';

// ============================================================================
// Payroll run actions: compute drafts, lock, mark paid, and edit the manual
// adjustments that feed net_payable.
//
// Every function here talks to the real database or fails loudly. There is no
// demo short-circuit that returns { ok: true } without writing: when Supabase
// is not configured the run simply cannot happen, and we say so.
//
// Postgres is the authority on what is allowed. fn_compute_run / fn_lock_run /
// fn_mark_run_paid RAISE on an illegal transition (migration 0005) and those
// messages are passed through to the operator verbatim — they are the whole
// point of the guard.
// ============================================================================
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getSession } from '@/lib/auth';
import type { AppRole, PayrollStatus } from '@/types/database';

/**
 * Roles allowed to move money. Deliberately NOT `STAFF_ROLES` from @/lib/auth:
 * that set includes 'viewer', but the database's is_staff() (migration 0003) is
 * admin/hr/manager only. A viewer would pass an isStaffRole() check, then have
 * every UPDATE silently filtered to zero rows by RLS — a write that reports
 * success and changes nothing. Mirroring is_staff() exactly turns that into an
 * honest, explained refusal.
 */
const PAYROLL_ROLES: readonly AppRole[] = ['admin', 'hr', 'manager'];

/** A run in one of these states is history; recompute/adjust must refuse. */
const FROZEN: readonly PayrollStatus[] = ['locked', 'paid'];

interface PgError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string;
}

/**
 * Flatten a PostgrestError into one readable line. RAISE messages arrive in
 * `message`; schema/permission problems put the useful half in `hint`/`details`.
 */
function pgMessage(error: PgError): string {
  return [error.message, error.details, error.hint].filter(Boolean).join(' — ');
}

type Gate = { ok: true; profileId: string } | { ok: false; error: string };

/** Resolve the caller and prove they may run payroll. */
async function gate(): Promise<Gate> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error:
        'Supabase is not configured, so payroll cannot run. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then reload.',
    };
  }

  const { profile } = await getSession();
  if (!profile) return { ok: false, error: 'You are not signed in.' };
  if (!PAYROLL_ROLES.includes(profile.role)) {
    return {
      ok: false,
      error: `Payroll actions need an admin, HR or manager account — yours is "${profile.role}".`,
    };
  }
  return { ok: true, profileId: profile.id };
}

/** Turn a thrown error (getSession, network, …) into a returned one. */
function caught(context: string, e: unknown): { ok: false; error: string } {
  const message = e instanceof Error ? e.message : String(e);
  return { ok: false, error: `${context}: ${message}` };
}

// ------------------------------------------------------------ run actions ---

/**
 * Open a fresh payroll run for a month so it can be computed from the app — the
 * onboarding step that previously required a manual SQL INSERT. Per migration
 * 0007 targets are per-employee, so the run's own working_days/target_minutes are
 * left null and populated by compute; status starts 'draft'.
 */
export async function openRun(periodMonth: string): Promise<{ ok: boolean; error?: string }> {
  const context = 'Start payroll run';
  try {
    const g = await gate();
    if (!g.ok) return { ok: false, error: g.error };

    const start = `${periodMonth.slice(0, 7)}-01`;
    const supabase = await createClient();

    const { data: existing, error: existErr } = await supabase
      .from('payroll_runs')
      .select('id')
      .eq('period_month', start)
      .maybeSingle();
    if (existErr) return { ok: false, error: pgMessage(existErr) };
    if (existing) return { ok: false, error: `A payroll run for ${start} already exists.` };

    const { data, error } = await supabase
      .from('payroll_runs')
      .insert({ period_month: start, status: 'draft' })
      .select('id');
    if (error) return { ok: false, error: pgMessage(error) };
    if (!data || data.length === 0) {
      return { ok: false, error: `${context}: no run was created — your role may lack permission.` };
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

    const supabase = await createClient();
    const { error } = await supabase.rpc(fn, { p_run_id: runId });
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
  return callRunRpc('fn_lock_run', runId, 'Lock run');
}

/** Mark a locked run (and its payslips) paid. */
export async function markRunPaid(runId: string): Promise<{ ok: boolean; error?: string }> {
  return callRunRpc('fn_mark_run_paid', runId, 'Mark run paid');
}

// ------------------------------------------------------------ adjustments ---

const MONEY_FIELDS = [
  'advance_recovery',
  'loss_damage',
  'last_month_balance',
  'reimbursement_bonus',
] as const;

type MoneyField = (typeof MONEY_FIELDS)[number];

const MONEY_LABEL: Record<MoneyField, string> = {
  advance_recovery: 'Advance recovery',
  loss_damage: 'Loss / damage',
  last_month_balance: 'Last month balance',
  reimbursement_bonus: 'Reimbursement / bonus',
};

/**
 * Parse a rupee field. Blank means zero; anything unparseable is a user error,
 * not a silent zero — writing 0 because someone typed "5oo" would quietly
 * change their pay.
 */
function money(formData: FormData, key: MoneyField): number | string {
  const raw = String(formData.get(key) ?? '').trim().replace(/[,\s₹]/g, '');
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${MONEY_LABEL[key]} must be a number (got "${raw}").`;
  // numeric(12,2) — round to paise so Postgres doesn't silently do it for us.
  return Math.round(n * 100) / 100;
}

/**
 * Save one payslip's manual adjustments, then recompute that payslip so
 * net_payable reflects them (migration 0005 made fn_compute_payslip read this
 * table).
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
    for (const field of MONEY_FIELDS) {
      const parsed = money(formData, field);
      if (typeof parsed === 'string') return { ok: false, error: parsed };
      values[field] = parsed;
    }
    const remarksRaw = String(formData.get('remarks') ?? '').trim();

    const supabase = await createClient();

    // Which employee/run does this payslip belong to?
    const { data: payslip, error: lookupError } = await supabase
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

    // Is the run still open? fn_compute_payslip has NO lock guard of its own
    // (0005 added one only to fn_compute_run), so calling it on a locked run
    // would rewrite an issued payslip behind the guard's back. Check here.
    //
    // Queried separately rather than as a `payroll_runs(status)` embed on the
    // select above: an embed's shape (object vs single-element array) depends on
    // PostgREST's view of the FK, and if it came back in an unexpected shape the
    // status would read `undefined` — which the previous `if (status && …)` form
    // treated as "not frozen" and wrote anyway. A guard standing in for a
    // missing database constraint must fail CLOSED, so this reads the column
    // directly and refuses when it cannot be established.
    const { data: run, error: runError } = await supabase
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
    if (FROZEN.includes(run.status)) {
      return {
        ok: false,
        error: `${context}: this payroll run is ${run.status} — adjustments are frozen and cannot be changed.`,
      };
    }

    const { error: upsertError } = await supabase.from('payslip_adjustments').upsert(
      {
        id: payslipId,
        ...values,
        remarks: remarksRaw || null,
        updated_by: g.profileId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (upsertError) return { ok: false, error: `${context}: ${pgMessage(upsertError)}` };

    // Recompute so the row the user is looking at tells the truth.
    const { error: recomputeError } = await supabase.rpc('fn_compute_payslip', {
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
