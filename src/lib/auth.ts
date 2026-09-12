// Authentication and role authorization utilities for server components and Server Actions.

export {
  staffRoles,
  isStaffRole,
  isEmployeeAreaRole,
  homeForRole,
} from '@/lib/roles';

export { getSession, getSessionUser, type SessionContext } from '@/lib/auth/session';
