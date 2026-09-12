/**
 * Request execution context and role-based permissions scope. SERVER ONLY.
 *
 * Resolves user identity, role privileges, and tenant employee association
 * for policy evaluation in the repository layer.
 */
import 'server-only';
import { getSessionUser } from '@/lib/auth/session';
import type { AppRole } from '@/types/database';

export interface Scope {
  userId: string;
  // employees._id for this account, or null for staff with no employee record.
  employeeId: string | null;
  role: AppRole;
  // Portal write permissions tier (super_admin, admin, hr).
  isStaff: boolean;
  // Administrative tier (admin, hr, super_admin).
  isAdminHr: boolean;
  isSuperAdmin: boolean;
  // Portal read permissions tier.
  isPortal: boolean;
  // True only for internal background jobs (scheduler and migrations).
  isSystem: boolean;
}

// System scope with full privileges for cron jobs and background tasks.
export const systemScope: Scope = {
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

// The signed-in caller's scope, or null when nobody is signed in. Reads through getSessionUser(), which is memoised per request and already performs the token_version and disabled checks — so a revoked session resolves to null here too, not to a stale scope.
export async function currentScope(): Promise<Scope | null> {
  const user = await getSessionUser();
  if (!user) return null;
  return scopeForRole(user._id, user.role, user.employee_id);
}
