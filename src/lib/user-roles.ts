// Pure role predicates shared by client and server code. Keep session imports in server-auth.ts so clients
// do not pull in server-only dependencies.
import { routes } from '@/lib/application-routes';
import type { AppRole } from '@/types/app';

// Roles that belong in the (portal) area.
const staffRoles: AppRole[] = ['super_admin', 'admin', 'hr'];

// Employees and interns use /employee. Intern payroll rules differ, but navigation access is shared.
const employeeAreaRoles: AppRole[] = ['employee', 'intern'];

const roleTier: Record<AppRole, number> = {
  super_admin: 3,
  admin: 2,
  hr: 1,
  employee: 0,
  intern: 0,
};

function tierOf(role: AppRole | null | undefined): number {
  return role ? (roleTier[role] ?? 0) : 0;
}

const tierLabel: Record<AppRole, string> = {
  super_admin: 'super admin',
  admin: 'admin',
  hr: 'HR',
  employee: 'employee',
  intern: 'intern',
};

function isStaffRole(role: AppRole | null | undefined): boolean {
  return !!role && staffRoles.includes(role);
}

// Recognize both employee and intern roles for /employee access. Do not classify interns as staff by
// checking only for employee.
function isEmployeeAreaRole(role: AppRole | null | undefined): boolean {
  return !!role && employeeAreaRoles.includes(role);
}

// Where a role lands after signing in.
function homeForRole(role: AppRole | null | undefined): '/employee' | '/dashboard' {
  return isEmployeeAreaRole(role) ? routes.employee : routes.dashboard;
}

export {
  staffRoles,
  employeeAreaRoles,
  tierOf,
  tierLabel,
  isStaffRole,
  isEmployeeAreaRole,
  homeForRole,
};
