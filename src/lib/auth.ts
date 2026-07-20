// ============================================================================
// Auth helpers shared by layouts, pages and Server Actions.
// ============================================================================
import { createClient } from '@/lib/supabase/server';
import { isDemoMode } from '@/lib/supabase/env';
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
  /** True when Supabase isn't configured — the app runs in open demo mode. */
  demo: boolean;
}

/**
 * Resolve the signed-in user + profile. In demo mode (dev/non-production with no
 * Supabase env) returns a synthetic admin so the UI renders. In production with
 * missing env this does NOT short-circuit — createClient() throws, hard-failing
 * the request rather than exposing a synthetic-admin session.
 */
export async function getSession(): Promise<SessionContext> {
  if (isDemoMode()) {
    return {
      userId: null,
      email: null,
      demo: true,
      profile: {
        id: 'demo',
        full_name: 'Meera Kulkarni',
        role: 'admin',
        branch_id: null,
        employee_id: null,
        created_at: '',
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, email: null, profile: null, demo: false };

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

  return { userId: user.id, email: user.email ?? null, profile: profile ?? null, demo: false };
}
