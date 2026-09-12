/**
 * Shared write-guard and validation helpers for Server Actions.
 *
 * Enforces standard mutation requirements:
 * 1. Active database connection requirement (fails closed when unconfigured).
 * 2. Role-based authorization gates for administrative actions.
 * 3. Write verification (ensures mutations modified at least one document).
 */
import { isMongoConfigured } from '@/lib/db/mongo';
import { getSession } from '@/lib/auth';
import type { createClient } from '@/lib/db/server';
import { monthSealReason, periodMonthFor, type PayrollRunSeal } from '@/lib/payroll-month';
import type { AppRole } from '@/types/database';

// Request-scoped database client type.
type DbClient = Awaited<ReturnType<typeof createClient>>;

/** Roles authorized to perform administrative write mutations. */
export const writeRoles: readonly AppRole[] = ['super_admin', 'admin', 'hr'];

export type StaffGate =
  | { ok: true; profileId: string; employeeId: string | null }
  | { ok: false; error: string };

/** Validates an administrative staff session (super_admin, admin, hr) with an active DB connection. */
export async function requireStaff(action = 'This action'): Promise<StaffGate> {
  if (!isMongoConfigured()) {
    return {
      ok: false,
      error: `${action} needs a database connection. MONGO_URI is not set, so nothing can be saved.`,
    };
  }
  const { profile } = await getSession();
  if (!profile) return { ok: false, error: 'You are not signed in.' };
  if (!writeRoles.includes(profile.role)) {
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
