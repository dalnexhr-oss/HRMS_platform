/** Resolve the caller's identity and role flags for repository policy checks. */
import 'server-only';
import { getSessionUser } from '@/lib/auth/session';
import type { AppRole } from '@/types/database';
import type { TabAccess } from '@/lib/portal-access';

// The caller's identity and role flags, used to filter queries and enforce policy.
//  The scope is derived from the session and is never trusted from the client. The system scope is used for
// background jobs and cron tasks, which have no session.
interface Scope {
  tabAccess?: TabAccess;
  userId: string;

  employeeId: string | null;
  role: AppRole;
  isStaff: boolean;
  isAdminHr: boolean;
  isSuperAdmin: boolean;
  isPortal: boolean;
  isSystem: boolean;
}

// System scope with full privileges for cron jobs and background tasks.
const systemScope: Scope = {
  userId: '__system__',
  employeeId: null,
  role: 'super_admin',
  isStaff: true,
  isAdminHr: true,
  isSuperAdmin: true,
  isPortal: true,
  isSystem: true,
};

function scopeForRole(
  userId: string,
  role: AppRole,
  employeeId: string | null,
  tabAccess: TabAccess = {},
): Scope {
  const isStaff = role === 'super_admin' || role === 'admin' || role === 'hr';
  return {
    tabAccess,
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

// Read the request-cached session, including disabled and token-version checks. Revoked sessions
// have no scope.
async function currentScope(): Promise<Scope | null> {
  const user = await getSessionUser();
  if (!user) {
    return null;
  }
  return scopeForRole(user._id, user.role, user.employee_id, user.tab_access ?? {});
}

export { systemScope, scopeForRole, currentScope };
export type { Scope };
