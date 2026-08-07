// ============================================================================
// Auth helpers shared by layouts, pages and Server Actions.
// ============================================================================
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import type { AppRole, Profile } from '@/types/database';

export const STAFF_ROLES: AppRole[] = ['admin', 'hr', 'manager', 'viewer'];

export function isStaffRole(role: AppRole | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

/** Where a role lands after signing in. */
export function homeForRole(role: AppRole | null | undefined): '/me' | '/today' {
  return role === 'employee' ? '/me' : '/today';
}

export interface SessionContext {
  userId: string | null;
  email: string | null;
  profile: Profile | null;
}

/**
 * Resolve the signed-in user + profile. Supabase is required: with missing env
 * createClient() throws, hard-failing the request rather than serving anything.
 *
 * Memoized per request. auth.getUser() is a NETWORK call to the Supabase auth
 * server, not a local token decode, and this function is reached three times on
 * a single navigation — the layout, the page, and every requireStaff()/requireDb()
 * in a Server Action. Without cache() that is six sequential round trips before
 * a single row of page data is fetched.
 *
 * One consequence worth knowing: Next re-renders in the SAME request after a
 * Server Action, so an action that mutates the caller's own profile renders the
 * pre-change value once. The account pages call router.refresh() afterwards —
 * a fresh request, fresh cache — so it self-corrects.
 */
export const getSession = cache(async function getSession(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, email: null, profile: null };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  // A failed lookup is a real failure (e.g. schema not applied). Surface it —
  // never let a broken database masquerade as "signed in with no profile".
  if (error) {
    throw new Error(`getSession: could not load your profile: ${error.message}`);
  }

  return { userId: user.id, email: user.email ?? null, profile: profile ?? null };
});
