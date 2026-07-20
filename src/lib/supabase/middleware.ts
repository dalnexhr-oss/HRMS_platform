import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseUrl, supabaseKey, isDemoMode } from '@/lib/supabase/env';

// 'viewer' is an intentional read-only PORTAL role, but it must never be handed
// out automatically: profiles.role now defaults to 'employee' (migration 0008)
// and a missing profile is treated as no-access below, so a user only becomes
// staff when an admin deliberately assigns a staff role.
const STAFF_ROLES = ['admin', 'hr', 'manager', 'viewer'];

// Refreshes the Supabase auth session on every request and gates the portal
// vs. the employee area by role. When Supabase isn't configured AND this is not
// a production build, the app runs in open demo mode (no gating). In production
// with missing env we hard-fail rather than serving an open portal.
export async function updateSession(request: NextRequest) {
  const url = supabaseUrl();
  const key = supabaseKey();

  let response = NextResponse.next({ request });
  if (!url || !key) {
    if (isDemoMode()) return response; // dev/demo — no auth
    // Production build with no Supabase env: fail closed, never open.
    return new NextResponse(
      'Server is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
        '(or NEXT_PUBLIC_SUPABASE_ANON_KEY) must be set at build time. Set ALLOW_DEMO=1 only for a ' +
        'deliberate, non-production demo.',
      { status: 503 },
    );
  }

  const path = request.nextUrl.pathname;
  const isLogin = path === '/login' || path.startsWith('/login/');
  const isAuthRoute = path.startsWith('/auth'); // OAuth callback

  // The /auth/* callback must always pass straight through: it performs the code
  // exchange and writes the session cookies itself. Gating it here (the signed-in
  // branch below redirects away from public routes) would abort the exchange.
  if (isAuthRoute) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // IMPORTANT: keep getUser() so the session token is refreshed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in → only the login page is allowed.
  if (!user) {
    if (isLogin) return response;
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Signed in: resolve role to route between the portal and the employee area.
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  // A failed profile lookup is a real failure (e.g. schema not applied). Never
  // guess a role from it — send the user to /login with the actual reason rather
  // than silently routing them into an area they may not belong in.
  if (profileError) {
    if (isLogin) return response; // already there — let the page render the error
    const to = new URL('/login', request.url);
    to.searchParams.set('error', `Could not load your profile: ${profileError.message}`);
    return NextResponse.redirect(to);
  }

  // No profile row at all is a fail-closed condition: never assume a role. A
  // signed-in user whose profile row is missing (trigger not run, deleted, or
  // an unprovisioned account) is sent back to /login with an explanation rather
  // than being routed into any area. This is the last line of defence behind the
  // 'employee' default (migration 0008) — a missing profile must not read as staff.
  if (!profile) {
    if (isLogin) return response;
    const to = new URL('/login', request.url);
    to.searchParams.set(
      'error',
      'Your account is not provisioned yet. Ask HR to set up your access.',
    );
    return NextResponse.redirect(to);
  }

  const role = profile.role;
  const isStaff = STAFF_ROLES.includes(role);
  const home = isStaff ? '/today' : '/me';

  // Already signed in but on the login page → send home.
  if (isLogin) return NextResponse.redirect(new URL(home, request.url));

  // Employees may only use the employee area; staff may not.
  const inEmployeeArea = path === '/me' || path.startsWith('/me/');
  if (!isStaff && !inEmployeeArea) {
    return NextResponse.redirect(new URL('/me', request.url));
  }
  if (isStaff && inEmployeeArea) {
    return NextResponse.redirect(new URL('/today', request.url));
  }

  return response;
}
