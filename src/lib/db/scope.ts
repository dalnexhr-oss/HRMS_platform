// ============================================================================
// Who is asking. SERVER ONLY.
//
// Postgres answered this with auth.uid(), auth_role(), current_employee_id()
// and is_staff() — functions RLS called on every row. Nothing in MongoDB does
// that, so the same facts are resolved once per request here and handed to the
// repository layer, which is what applies them.
//
// The role tiers mirror the SQL helpers exactly:
//   is_staff()    -> super_admin, admin, hr        (portal WRITE tier)
//   is_admin_hr() -> admin, hr                     (+ super_admin, which
//                    outranks both and was granted separately)
//   is_portal()   -> super_admin, admin, hr        (portal READ tier)
//
// 0046 withdrew the manager tier's write access and left it at employee level,
// so no role sits between employee and hr.
// ============================================================================
import 'server-only';
import { getSessionUser } from '@/lib/auth/session';
import type { AppRole } from '@/types/database';

export interface Scope {
  userId: string;
  /** employees._id for this account, or null for staff with no employee record. */
  employeeId: string | null;
  role: AppRole;
  /** Portal write tier. Mirrors is_staff(). */
  isStaff: boolean;
  /** Mirrors is_admin_hr(). super_admin is included: it outranks both. */
  isAdminHr: boolean;
  isSuperAdmin: boolean;
  /** Portal read tier. Mirrors is_portal(). */
  isPortal: boolean;
  /**
   * True ONLY for SYSTEM_SCOPE — the scheduler and migrations, never a request.
   *
   * Every other flag here is a role tier that some real account can hold, so
   * none of them can express "the job runner, and nobody who can sign in".
   * A policy needs that to grant something to the scheduler alone: the cron
   * ledger is the case — it must stay unwritable by any user while the job that
   * wrote a claim is still able to take it back when its work fails.
   */
  isSystem: boolean;
}

/**
 * The system scope, used by cron jobs and migrations.
 *
 * Equivalent to the service-role key: it sees and writes everything. Reachable
 * only through systemRepos(), which is deliberately awkward to call by accident.
 */
export const SYSTEM_SCOPE: Scope = {
  userId: '__system__',
  employeeId: null,
  role: 'super_admin',
  isStaff: true,
  isAdminHr: true,
  isSuperAdmin: true,
  isPortal: true,
  isSystem: true,
};

export function scopeForRole(
  userId: string,
  role: AppRole,
  employeeId: string | null,
): Scope {
  const isStaff = role === 'super_admin' || role === 'admin' || role === 'hr';
  return {
    userId,
    employeeId,
    role,
    isStaff,
    isAdminHr: isStaff,
    isSuperAdmin: role === 'super_admin',
    isPortal: isStaff,
    // Never true for anything built from a session. See the field's comment.
    isSystem: false,
  };
}

/**
 * The signed-in caller's scope, or null when nobody is signed in.
 *
 * Reads through getSessionUser(), which is memoised per request and already
 * performs the token_version and disabled checks — so a revoked session
 * resolves to null here too, not to a stale scope.
 */
export async function currentScope(): Promise<Scope | null> {
  const user = await getSessionUser();
  if (!user) return null;
  return scopeForRole(user._id, user.role, user.employee_id);
}
