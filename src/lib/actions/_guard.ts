// ============================================================================
// Shared write-guard helpers for Server Actions.
//
// These centralise the three things every mutating action must do, and which
// the older actions were doing inconsistently (or not at all):
//   1. Refuse in demo mode — a write with no database is a FAILURE, not a
//      silent {ok:true} over nothing persisted.
//   2. Gate on a real staff role at the app layer (admin/hr/manager), mirroring
//      the database's is_staff() so a viewer gets an explained refusal instead of
//      a raw 42501 or a silent RLS no-op.
//   3. Verify a write actually touched rows — an RLS-filtered UPDATE/DELETE
//      affects zero rows, which PostgREST reports as success.
//
// This is NOT a 'use server' module: it exports non-action helpers (a const and
// a sync function) that are imported BY the action modules. Keeping it plain
// avoids the "every export must be an async function" rule of 'use server'.
// ============================================================================
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getSession } from '@/lib/auth';
import type { AppRole } from '@/types/database';

/**
 * Roles allowed to write. Deliberately NOT STAFF_ROLES from '@/lib/auth' — that
 * set includes 'viewer', but the database's is_staff() (migration 0003) is only
 * ('admin','hr','manager'). Gating on the wider set would wave a viewer through
 * the UI and into an RLS denial.
 */
export const WRITE_ROLES: readonly AppRole[] = ['admin', 'hr', 'manager'];

export type StaffGate =
  | { ok: true; profileId: string; employeeId: string | null }
  | { ok: false; error: string };

/**
 * Gate a staff write: requires a real DB connection AND an admin/hr/manager
 * session. `action` names the operation for the error message ("Deleting a
 * holiday", …).
 */
export async function requireStaff(action = 'This action'): Promise<StaffGate> {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: `${action} needs a database connection. Supabase is not configured, so nothing can be saved (demo data is read-only).`,
    };
  }
  const { profile } = await getSession();
  if (!profile) return { ok: false, error: 'You are not signed in.' };
  if (!WRITE_ROLES.includes(profile.role)) {
    return {
      ok: false,
      error: `${action} needs an admin, HR or manager account — yours is "${profile.role}".`,
    };
  }
  return { ok: true, profileId: profile.id, employeeId: profile.employee_id };
}

/**
 * A lighter guard for employee-facing writes (raise ticket, acknowledge policy):
 * they don't need a staff role, but a write in demo mode is still a failure, not
 * a fake success.
 */
export function requireDb(action = 'This action'): { ok: true } | { ok: false; error: string } {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      error: `${action} needs a database connection. Supabase is not configured, so nothing can be saved (demo data is read-only).`,
    };
  }
  return { ok: true };
}

/**
 * True when an UPDATE/DELETE that returned rows via `.select()` changed nothing —
 * the standard signature of an RLS-filtered or stale-id no-op that PostgREST
 * reports as success.
 */
export function wroteNothing(data: unknown[] | null): boolean {
  return !data || data.length === 0;
}
