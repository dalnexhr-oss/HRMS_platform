// ============================================================================
// Shared write-guard helpers for Server Actions.
//
// These centralise the three things every mutating action must do, and which
// the older actions were doing inconsistently (or not at all):
//   1. Refuse when there is no database configured — a write with nothing to
//      write to is a FAILURE, not a silent {ok:true} over nothing persisted.
//   2. Gate on a real staff role at the app layer (super_admin/admin/hr), so an
//      account that may only READ the portal cannot reach the action and have
//      every UPDATE come back as a successful no-op.
//   3. Verify a write actually touched rows. A policy-filtered UPDATE or DELETE
//      matches nothing, and matching nothing is reported as success.
//
// This is NOT a 'use server' module: it exports non-action helpers (a const and
// a sync function) that are imported BY the action modules. Keeping it plain
// avoids the "every export must be an async function" rule of 'use server'.
// ============================================================================
import { isMongoConfigured } from '@/lib/db/mongo';
import { getSession } from '@/lib/auth';
import type { createClient } from '@/lib/db/server';
import { monthSealReason, periodMonthFor, type PayrollRunSeal } from '@/lib/payroll-month';
import type { AppRole } from '@/types/database';

/** The request-scoped database client, as createClient() returns it. */
type DbClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Roles allowed to write.
 *
 * Matches is_staff() in the SQL exactly as of 0046, which withdrew the
 * manager tier's write access and left managers at employee level. The set is
 * spelled out here rather than imported from '@/lib/auth' so that widening the
 * portal's READ roles can never silently widen who may write.
 */
export const WRITE_ROLES: readonly AppRole[] = ['super_admin', 'admin', 'hr'];

export type StaffGate =
  | { ok: true; profileId: string; employeeId: string | null }
  | { ok: false; error: string };

/**
 * Gate a staff write: requires a real DB connection AND a super-admin, admin or
 * HR session. `action` names the operation for the error message ("Deleting a
 * holiday", …).
 */
export async function requireStaff(action = 'This action'): Promise<StaffGate> {
  if (!isMongoConfigured()) {
    return {
      ok: false,
      error: `${action} needs a database connection. MONGO_URI is not set, so nothing can be saved.`,
    };
  }
  const { profile } = await getSession();
  if (!profile) return { ok: false, error: 'You are not signed in.' };
  if (!WRITE_ROLES.includes(profile.role)) {
    return {
      ok: false,
      error: `${action} needs a super admin, admin or HR account — yours is "${profile.role}".`,
    };
  }
  return { ok: true, profileId: profile.id, employeeId: profile.employee_id };
}

/**
 * Gate on an explicit role set — for operations narrower than "staff", such as
 * user administration. Returns the caller's own role so the action can apply
 * finer rules (e.g. only a super admin may mint another super admin).
 */
export async function requireRoles(
  roles: readonly AppRole[],
  action = 'This action',
): Promise<
  { ok: true; profileId: string; role: AppRole } | { ok: false; error: string }
> {
  if (!isMongoConfigured()) {
    return {
      ok: false,
      error: `${action} needs a database connection. MONGO_URI is not set, so nothing can be saved.`,
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
 * they don't need a staff role, but a write with no database is still a failure, not
 * a fake success.
 */
export function requireDb(action = 'This action'): { ok: true } | { ok: false; error: string } {
  if (!isMongoConfigured()) {
    return {
      ok: false,
      error: `${action} needs a database connection. MONGO_URI is not set, so nothing can be saved.`,
    };
  }
  return { ok: true };
}

/**
 * Refuse to write attendance into a month whose payroll is already locked or paid.
 *
 * correctAttendance enforced this; the register IMPORT and the night SWEEP did
 * not, which meant either could quietly rewrite a closed month (an import is
 * per-month and a sweep takes an arbitrary date).
 *
 * Fails CLOSED: if the run status cannot be read, the write is refused. The
 * rule itself is in lib/payroll-month.ts, shared with the scheduler.
 *
 * `workDate` is 'YYYY-MM-DD'; only its month is used.
 */
export async function requireOpenPayrollMonth(
  dbc: DbClient,
  workDate: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const periodMonth = periodMonthFor(workDate);
  const { data, error } = await dbc
    .from('payroll_runs')
    .select('status, month_closed_at')
    .eq('period_month', periodMonth)
    // month_closed_at is a BSON date; only its presence is tested.
    .maybeSingle<PayrollRunSeal>();

  if (error) {
    return {
      ok: false,
      error: `Could not check the payroll run for ${periodMonth}: ${error.message}`,
    };
  }

  const sealed = monthSealReason(periodMonth, data);
  return sealed ? { ok: false, error: sealed } : { ok: true };
}

/**
 * True when an UPDATE/DELETE that returned rows via `.select()` changed nothing
 * — the standard signature of a policy-filtered or stale-id no-op, which the
 * query layer reports as success because matching no rows is not an error.
 */
export function wroteNothing(data: unknown[] | null): boolean {
  return !data || data.length === 0;
}
