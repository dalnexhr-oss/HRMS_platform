// Authentication and role authorization utilities for server components and Server Actions.

import { staffRoles, isStaffRole, isEmployeeAreaRole, homeForRole } from '@/lib/roles';
import { getSession, getSessionUser } from '@/lib/auth/session';
import type { SessionContext } from '@/lib/auth/session';

export {
  staffRoles,
  isStaffRole,
  isEmployeeAreaRole,
  homeForRole,
  getSession,
  getSessionUser,
  type SessionContext,
};
