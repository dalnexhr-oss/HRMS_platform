import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireSupabaseEnv, supabaseServiceKey, supabaseUrl } from '@/lib/supabase/env';

// Server Supabase client for Server Components / Route Handlers / Server Actions.
// Reads and refreshes the auth session from cookies.
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Called from a Server Component, where cookies are read-only — safe to
          // ignore; middleware refreshes the session on the next request.
          // NOTE: Route Handlers (e.g. /auth/callback) CAN write cookies, and this
          // catch does not swallow that: next/headers cookies() is writable there,
          // so the session set during the OAuth code exchange does persist.
        }
      },
    },
  });
}

// Service-role client for privileged, non-user jobs (night sweep, payroll compute).
// SERVER ONLY. Bypasses RLS — never import into a client component.
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Privileged client. The secret key is not provisioned in every environment, so
 * this throws a clear, catchable error *only when called* — importing this
 * module must never crash the app.
 */
export function createServiceClient() {
  const url = supabaseUrl();
  const serviceKey = supabaseServiceKey();
  if (!url) {
    throw new Error(
      'createServiceClient: NEXT_PUBLIC_SUPABASE_URL is not set. Add it to .env.local.',
    );
  }
  if (!serviceKey) {
    throw new Error(
      'createServiceClient: no secret key set, so privileged operations (seed:users, ' +
        'night sweep, payroll compute) are unavailable. Add SUPABASE_SECRET_KEY ' +
        '(sb_secret_…) — or the legacy SUPABASE_SERVICE_ROLE_KEY — to .env.local.',
    );
  }
  return createSupabaseClient(url, serviceKey, { auth: { persistSession: false } });
}

/** True when createServiceClient() can succeed — check before offering privileged actions. */
export function isServiceRoleConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseServiceKey());
}
