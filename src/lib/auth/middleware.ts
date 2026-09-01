// ============================================================================
// Request gate. Replaces lib/dbc/middleware.ts.
//
// Runs on the EDGE runtime, so it can verify the JWT but cannot reach MongoDB.
// That split is deliberate and unchanged from the Supabase design: middleware
// does UX routing ("signed in, or go to /login"), and it was never the security
// boundary. The boundary is now the scoped data layer plus the token_version
// check in getSession(), both of which run on the server with database access.
//
// What that means in practice: a revoked or disabled account still gets past
// this file, and is then rejected by the layout's getSession() on the very same
// request. No data is reachable in between.
// ============================================================================
import { NextResponse, type NextRequest } from 'next/server';
import { verifySession } from '@/lib/auth/jwt';
import { SESSION_COOKIE } from '@/lib/auth/session-shared';

export async function updateSession(request: NextRequest) {
  // The (portal) layout enforces per-tab access and needs to know which tab was
  // requested, which a Server Component cannot read on its own. Forwarding the
  // path as a header costs nothing and keeps that enforcement in one place
  // rather than repeated across ~21 page files.
  //
  // Headers are copied rather than mutated: NextRequest.headers is immutable in
  // some runtimes, and a throw here would 500 every request.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  const forward = () => NextResponse.next({ request: { headers: requestHeaders } });

  const response = forward();

  const path = request.nextUrl.pathname;
  const isLogin = path === '/login' || path.startsWith('/login/');
  const isAuthRoute = path.startsWith('/auth');
  // Route handlers are fetched by JavaScript, which cannot follow a redirect to
  // an HTML login page — it would parse the markup as JSON and report a syntax
  // error instead of "signed out". They get a 401 they can act on. Every route
  // under /api already performs its own role check and returns JSON errors, so
  // this only changes the unauthenticated case.
  const isApi = path.startsWith('/api/');

  // /api/cron carries its own bearer secret and is called by a machine that has
  // no session and never will. Gating it here would make the scheduled jobs
  // unreachable; the route refuses outright when CRON_SECRET is unset, so
  // passing through does not open anything.
  if (path === '/api/cron' || path.startsWith('/api/cron/')) return response;

  // /auth/* handles its own flows (password reset, invite acceptance) and
  // writes cookies itself. Gating it here would abort those.
  if (isAuthRoute) return response;

  // A prefetch is speculative and must never cost work. The sidebar holds ~19
  // links, all in the viewport, so one page load fires 19 prefetches. Access is
  // still enforced: the layouts redirect and the data layer scopes every query.
  if (
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch'
  ) {
    return response;
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  // Signature + expiry only. No database, no network — this is a local verify
  // against the shared secret, so it costs microseconds per request.
  const claims = token ? await verifySession(token) : null;

  if (!claims) {
    if (isLogin) return response;
    if (isApi) {
      return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    }
    const target = new URL('/login', request.url);
    // Preserve where they were headed so sign-in can return them to it.
    if (path !== '/') target.searchParams.set('next', path);
    return NextResponse.redirect(target);
  }

  if (isLogin) {
    // An ?error= on /login means something upstream deliberately sent the user
    // here to read it. Bouncing them off would loop.
    if (request.nextUrl.searchParams.has('error')) return response;
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}
