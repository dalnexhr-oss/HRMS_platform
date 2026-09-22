// Authentication and role authorization utilities for server components and Server Actions.

import { staffRoles, isStaffRole, isEmployeeAreaRole, homeForRole } from '@/lib/roles';
import { getSession, getSessionUser } from '@/lib/auth/session';
import type { SessionContext } from '@/lib/auth/session';

export { staffRoles, isStaffRole, isEmployeeAreaRole, homeForRole, getSession, getSessionUser };

export type { AppRole } from '@/types/database';
export type { SessionClaims } from '@/lib/auth/session';
export type { DocumentCategory } from '@/lib/constants';
export type { Scope } from '@/lib/db/scope';
export type { TabAccess } from '@/lib/access';
export type { SessionContext };
