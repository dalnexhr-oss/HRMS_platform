// ============================================================================
// Which area a role belongs to. Pure predicates, no I/O and no server imports.
//
// These live apart from lib/auth.ts on purpose: that module re-exports
// getSession from lib/auth/session, which is marked 'server-only', so a client
// component asking it a simple question about a role string drags the whole
// session reader into the browser bundle and fails the build. Client screens
// import from here; lib/auth re-exports the same functions so the many existing
// server call sites keep their import path.
// ============================================================================
import type { AppRole } from '@/types/app';

/** Roles that belong in the (portal) area. */
export const STAFF_ROLES: AppRole[] = ['super_admin', 'admin', 'hr'];

/**
 * Roles that use the employee self-service area rather than the portal.
 *
 * 'manager' is NOT one: it was reduced to employee-level access and then folded
 * into 'employee'. 'intern' IS one — an intern reaches the same /me dashboard as
 * an employee, and differs only in how payroll pays them.
 */
export const EMPLOYEE_AREA_ROLES: AppRole[] = ['employee', 'intern'];

export function isStaffRole(role: AppRole | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

/**
 * True for the roles that live on /me. Every "is this an employee?" test has to
 * ask this rather than compare against 'employee': a bare `role !== 'employee'`
 * reads an intern as staff, which is how an intern would have ended up posting
 * helpdesk replies carrying a staff badge.
 */
export function isEmployeeAreaRole(role: AppRole | null | undefined): boolean {
  return !!role && EMPLOYEE_AREA_ROLES.includes(role);
}

/** Where a role lands after signing in. */
export function homeForRole(role: AppRole | null | undefined): '/me' | '/today' {
  return isEmployeeAreaRole(role) ? '/me' : '/today';
}
