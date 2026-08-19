import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseUrl, supabaseKey } from '@/lib/supabase/env';

// Refreshes the Supabase auth session on every request and enforces "signed in
// or go to /login". Supabase is required: with missing env we hard-fail (503)
// rather than serving anything.
//
// ROLE routing (portal vs. employee area) used to happen here too, at the cost
// of a `profiles` SELECT on EVERY request. It now lives in the two route-group
// layouts, which already load the profile through the request-memoized
// getSession() — so the same gate costs nothing. This is not a weakening:
// middleware was never the security boundary (RLS is, on every table), it was
// doing UX routing, and a layout redirect() aborts the render just as hard.
export async function updateSession(request: NextRequest) {
  const url = supabaseUrl();
  const key = supabaseKey();

  // The (portal) layout enforces per-tab access (migration 0044) and needs to
  // know which tab was requested, which a Server Component cannot read on its
  // own. Forwarding it as a request header costs nothing — no extra round trip,
  // no database read here — and keeps the enforcement in one place instead of
  // repeating a guard in all ~21 page files.
  // Copied rather than mutated in place: NextRequest.headers is immutable in
  // some runtimes, and a throw here would 500 every portal request.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  const forward = () => NextResponse.next({ request: { headers: requestHeaders } });

  let response = forward();
  if (!url || !key) {
    // No Supabase env: fail closed, never open.
    return new NextResponse(
      'Server is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ' +
        '(or NEXT_PUBLIC_SUPABASE_ANON_KEY) must be set at build time.',
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

  // A prefetch is speculative and must never spend a round trip to Mumbai. The
  // sidebar holds ~19 links, all in the viewport at once, so one page load used
  // to fire 19 prefetches — each running the auth pair here AND re-rendering the
  // whole portal layout. That saturates a free-tier pooler and starves the
  // navigation the user actually clicked. Access is still enforced: the layouts
  // redirect, and RLS backs every table.
  if (
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch'
  ) {
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = forward();
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getClaims() still calls getSession() internally, so the token is refreshed
  // exactly as getUser() did. The difference: on a project using asymmetric JWT
  // signing keys it verifies the token LOCALLY against a cached JWKS instead of
  // making a network call. On the legacy HS256 shared secret it transparently
  // falls back to getUser(), i.e. no worse than before either way.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub ?? null;

  // Not signed in → only the login page is allowed.
  if (!userId) {
    if (isLogin) return response;
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isLogin) {
    // An ?error= on /login means something upstream (the auth callback, or a
    // layout that found no profile row) deliberately sent the user here to read
    // it. Bouncing them off would loop: /login → / → layout → /login → …
    if (request.nextUrl.searchParams.has('error')) return response;
    // Otherwise: signed in and idly on /login → send to '/', which resolves the
    // right home per role. Resolving it here would cost the profiles query this
    // whole change exists to remove.
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}
