// Pure role predicates shared by client and server code. Keep session imports in auth.ts so clients
// do not pull in server-only dependencies.
import type { AppRole } from '@/types/app';

// Roles that belong in the (portal) area.
export const staffRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

// Employees and interns use /me. Intern payroll rules differ, but navigation access is shared.
export const employeeAreaRoles: AppRole[] = ['employee', 'intern'];

export function isStaffRole(role: AppRole | null | undefined): boolean {
  return !!role && staffRoles.includes(role);
}

// Recognize both employee and intern roles for /me access. Do not classify interns as staff by
// checking only for employee.
export function isEmployeeAreaRole(role: AppRole | null | undefined): boolean {
  return !!role && employeeAreaRoles.includes(role);
}

// Where a role lands after signing in.
export function homeForRole(role: AppRole | null | undefined): '/me' | '/today' {
  return isEmployeeAreaRole(role) ? '/me' : '/today';
}
