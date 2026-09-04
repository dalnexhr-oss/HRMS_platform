// ============================================================================
// Auth helpers shared by layouts, pages and Server Actions.
//
// The import path is unchanged on purpose. getSession() used to call Supabase
// and read public.profiles; it now verifies a signed JWT and reads the users
// collection. Every one of the ~56 call sites keeps working because the return
// shape ({ userId, email, profile }) is identical — the swap happens in
// lib/auth/session.ts, underneath them.
// ============================================================================
export {
  STAFF_ROLES,
  isStaffRole,
  isEmployeeAreaRole,
  homeForRole,
} from '@/lib/roles';

// Re-exported so the old '@/lib/auth' import path still resolves everywhere.
export { getSession, getSessionUser, type SessionContext } from '@/lib/auth/session';
