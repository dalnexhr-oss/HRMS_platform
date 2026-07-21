// ============================================================================
// OAuth / PKCE callback. Supabase redirects here with ?code=... after the user
// approves the GitHub authorisation screen. We exchange that code for a session
// (which writes the auth cookies) and then send the user to their role's home.
//
// This route MUST stay reachable without auth — src/lib/supabase/middleware.ts
// lets every /auth/* path pass straight through.
// ============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { homeForRole } from '@/lib/auth';
import type { AppRole } from '@/types/database';

function loginWithError(request: NextRequest, message: string) {
  const to = new URL('/login', request.url);
  to.searchParams.set('error', message);
  return NextResponse.redirect(to);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  if (!isSupabaseConfigured()) {
    return loginWithError(request, 'Supabase is not configured, so sign-in is unavailable.');
  }

  // The provider itself can fail (user hit "cancel", app not authorised, ...).
  const providerError = searchParams.get('error_description') ?? searchParams.get('error');
  if (providerError) return loginWithError(request, providerError);

  const code = searchParams.get('code');
  if (!code) return loginWithError(request, 'Sign-in did not return an authorisation code.');

  const supabase = await createClient();

  // Route Handlers can write cookies, so this persists the session.
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return loginWithError(request, error.message);

  const userId = data.user?.id;
  if (!userId) return loginWithError(request, 'Sign-in completed but no user was returned.');

  // A `next` param (used by the password-recovery link) redirects to a specific
  // in-app page after the session is established.
  //
  // The check below is stricter than "starts with / and not //": WHATWG URL
  // parsing treats a BACKSLASH as a slash in a special-scheme URL, so the old
  // guard let `/\evil.com` through — new URL('/\evil.com', origin) resolves to
  // https://evil.com/, handing an attacker an open redirect on the page that
  // has just established a session. Resolve first, then require the ORIGIN to
  // match, which is decided by the parser rather than by string shape.
  const next = searchParams.get('next');
  if (next) {
    const base = new URL(request.url);
    let target: URL | null = null;
    try {
      target = new URL(next, base);
    } catch {
      target = null;
    }
    if (target && target.origin === base.origin) {
      return NextResponse.redirect(target);
    }
    // A next that does not resolve same-origin is dropped, not followed.
  }

  // profiles.role drives routing. A new self-service sign-in gets a profile from
  // the handle_new_user() trigger, which defaults role to 'employee' (a non-portal
  // role) — see supabase/migrations/0008_auth_hardening.sql. Surface a lookup
  // failure instead of guessing a role and landing them in the wrong area.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    return loginWithError(request, `Signed in, but your profile could not be loaded: ${profileError.message}`);
  }

  const role = (profile?.role ?? 'employee') as AppRole;
  return NextResponse.redirect(new URL(homeForRole(role), request.url));
}
