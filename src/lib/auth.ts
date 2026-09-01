// ============================================================================
// Auth helpers shared by layouts, pages and Server Actions.
//
// The import path is unchanged on purpose. getSession() used to call Supabase
// and read public.profiles; it now verifies a signed JWT and reads the users
// collection. Every one of the ~56 call sites keeps working because the return
// shape ({ userId, email, profile }) is identical — the swap happens in
// lib/auth/session.ts, underneath them.
// ============================================================================
import type { AppRole } from '@/types/database';

// Re-exported so the old '@/lib/auth' import path still resolves everywhere.
export { getSession, getSessionUser, type SessionContext } from '@/lib/auth/session';

/**
 * Roles that belong in the (portal) area. `manager` is NOT one: 0046 reduced it
 * to employee-level access, so a manager lands on /me like an employee.
 */
export const STAFF_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];

/** Roles that use the employee self-service area rather than the portal. */
const EMPLOYEE_AREA_ROLES: AppRole[] = ['employee'];

export function isStaffRole(role: AppRole | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

/** Where a role lands after signing in. */
export function homeForRole(role: AppRole | null | undefined): '/me' | '/today' {
  return role != null && EMPLOYEE_AREA_ROLES.includes(role) ? '/me' : '/today';
}
