// ============================================================================
// Single source of truth for resolving Supabase connection env vars.
//
// Supabase issues two key styles:
//   - NEW: sb_publishable_...  -> NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//   - LEGACY: eyJhbGciOi...    -> NEXT_PUBLIC_SUPABASE_ANON_KEY
// We prefer the new one and fall back to the legacy alias so either .env works.
//
// IMPORTANT: NEXT_PUBLIC_* vars are inlined into the bundle at BUILD time by
// Next.js, which does a literal text substitution on `process.env.NEXT_PUBLIC_X`.
// They must therefore be written out as full static member expressions — never
// `process.env[key]` or destructured — or they resolve to undefined in the
// browser. Keep the expressions below verbatim.
// ============================================================================

/** The Supabase project URL, or undefined when unset. */
export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/** Publishable (new-style) key, falling back to the legacy anon key. */
export function supabaseKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** True when a URL + key pair is present. Supabase is required to run the app. */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabaseKey());
}

/**
 * Service-role key for privileged server jobs. Never exposed to the browser.
 *
 * Supabase renamed this too: the new dashboard issues `sb_secret_...` as
 * SUPABASE_SECRET_KEY, while older projects use the legacy service_role JWT as
 * SUPABASE_SERVICE_ROLE_KEY. Accept either, preferring the new name.
 */
export function supabaseServiceKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Resolve URL + key or throw a clear, actionable error. Use at Supabase entry
 * points that cannot meaningfully continue without a connection.
 */
export function requireSupabaseEnv(): { url: string; key: string } {
  const url = supabaseUrl();
  const key = supabaseKey();
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) in .env.local.',
    );
  }
  return { url, key };
}
