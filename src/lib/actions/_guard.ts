// ============================================================================
// Shared write-guard helpers for Server Actions.
//
// These centralise the three things every mutating action must do, and which
// the older actions were doing inconsistently (or not at all):
//   1. Refuse in demo mode — a write with no database is a FAILURE, not a
//      silent {ok:true} over nothing persisted.
//   2. Gate on a real staff role at the app layer (admin/hr/manager), mirroring
//      the database's is_staff() so a viewer gets an explained refusal instead of
//      a raw 42501 or a silent RLS no-op.
//   3. Verify a write actually touched rows — an RLS-filtered UPDATE/DELETE
//      affects zero rows, which PostgREST reports as success.
//
// This is NOT a 'use server' module: it exports non-action helpers (a const and
// a sync function) that are imported BY the action modules. Keeping it plain
// avoids the "every export must be an async function" rule of 'use server'.
// ============================================================================
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getSession } from '@/lib/auth';
import type { createClient } from '@/lib/supabase/server';
import type { AppRole } from '@/types/database';

/** The request-scoped Supabase server client, as createClient() returns it. */
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Roles allowed to write. Deliberately NOT STAFF_ROLES from '@/lib/auth' — that
 * set includes 'viewer', but the database's is_staff() (migration 0003) is only
 * ('admin','hr','manager'). Gating on the wider set would wave a viewer through
 * the UI and into an RLS denial.
 */
export const WRITE_ROLES: readonly AppRole[] = ['admin', 'hr', 'manager'];

export type StaffGate =
  | { ok: true; profileId: string; employeeId: string | null }
  | { ok: false; error: string };

/**
 * Gate a staff write: requires a real DB connection AND an admin/hr/manager
 * session. `action` names the operation for the error message ("Deleting a
 * holiday", …).
 */
export async function requireStaff(action = 'This action'): Promise<StaffGate> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: `${action} needs a database connection. Supabase is not configured, so nothing can be saved (demo data is read-only).`,
    };
  }
  const { profile } = await getSession();
  if (!profile) return { ok: false, error: 'You are not signed in.' };
  if (!WRITE_ROLES.includes(profile.role)) {
    return {
      ok: false,
      error: `${action} needs an admin, HR or manager account — yours is "${profile.role}".`,
    };
  }
  return { ok: true, profileId: profile.id, employeeId: profile.employee_id };
}

/**
 * Gate on an explicit role set — for operations narrower than "staff", such as
 * user administration (admin/hr only). Returns the caller's own role so the
 * action can apply finer rules (e.g. only an admin may mint another admin).
 */
export async function requireRoles(
  roles: readonly AppRole[],
  action = 'This action',
): Promise<
  { ok: true; profileId: string; role: AppRole } | { ok: false; error: string }
> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: `${action} needs a database connection. Supabase is not configured, so nothing can be saved (demo data is read-only).`,
    };
  }
  const { profile } = await getSession();
  if (!profile) return { ok: false, error: 'You are not signed in.' };
  if (!roles.includes(profile.role)) {
    return {
      ok: false,
      error: `${action} needs a ${roles.join(' or ')} account — yours is "${profile.role}".`,
    };
  }
  return { ok: true, profileId: profile.id, role: profile.role };
}

/**
 * A lighter guard for employee-facing writes (raise ticket, acknowledge policy):
 * they don't need a staff role, but a write in demo mode is still a failure, not
 * a fake success.
 */
export function requireDb(action = 'This action'): { ok: true } | { ok: false; error: string } {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: `${action} needs a database connection. Supabase is not configured, so nothing can be saved (demo data is read-only).`,
    };
  }
  return { ok: true };
}

/**
 * Refuse to write attendance into a month whose payroll is already locked or paid.
 *
 * Payslips are final once a run is locked, and 0005 blocks the recompute — so
 * changing the attendance behind them silently desyncs pay from the register and
 * the numbers can never catch up. correctAttendance enforced this; the register
 * IMPORT and the night SWEEP did not, which meant either could quietly rewrite a
 * closed month (an import is per-month and a sweep takes an arbitrary date).
 *
 * Fails CLOSED: if the run status cannot be read, the write is refused.
 *
 * `workDate` is 'YYYY-MM-DD'; only its month is used.
 */
export async function requireOpenPayrollMonth(
  supabase: SupabaseServerClient,
  workDate: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const periodMonth = `${workDate.slice(0, 7)}-01`;
  const { data, error } = await supabase
    .from('payroll_runs')
    .select('status')
    .eq('period_month', periodMonth)
    .maybeSingle<{ status: string }>();

  if (error) {
    return {
      ok: false,
      error: `Could not check the payroll run for ${periodMonth}: ${error.message}`,
    };
  }

  const status = data?.status;
  if (status === 'locked' || status === 'paid') {
    return {
      ok: false,
      error: `Payroll for ${periodMonth.slice(0, 7)} is ${status}. Attendance for that month can no longer be changed — raise a payslip adjustment instead.`,
    };
  }
  return { ok: true };
}

/**
 * True when an UPDATE/DELETE that returned rows via `.select()` changed nothing —
 * the standard signature of an RLS-filtered or stale-id no-op that PostgREST
 * reports as success.
 */
export function wroteNothing(data: unknown[] | null): boolean {
  return !data || data.length === 0;
}
