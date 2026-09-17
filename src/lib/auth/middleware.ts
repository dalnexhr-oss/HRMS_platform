// Verify JWT signatures at the edge and route unauthenticated requests to login. Server session
// checks enforce revocation; layouts and repository policies enforce authorization.
import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/jwt';
import { sessionCookie } from '@/lib/auth/session-shared';
import type { NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  // Forward the pathname for the portal layout's tab-access check. Copy request headers because
  // they may be immutable in this runtime.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  const forward = () => NextResponse.next({ request: { headers: requestHeaders } });

  const response = forward();

  const path = request.nextUrl.pathname;
  const isLogin = path === '/login' || path.startsWith('/login/');
  const isAuthRoute = path.startsWith('/auth');
  // Return JSON 401 for API requests so clients can handle an expired session without trying to
  // parse an HTML login page.
  const isApi = path.startsWith('/api/');

  // Cron authenticates with its own bearer secret and has no browser session. The endpoint refuses
  // requests when CRON_SECRET is unset.
  if (path === '/api/cron' || path.startsWith('/api/cron/')) {
    return response;
  }

  // /auth/* handles its own flows (password reset, invite acceptance) and
  // writes cookies itself. Gating it here would abort those.
  if (isAuthRoute) {
    return response;
  }

  // A prefetch is speculative and must never cost work. The sidebar holds ~19
  // links, all in the viewport, so one page load fires 19 prefetches. Access is
  // still enforced: the layouts redirect and the data layer scopes every query.
  if (
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch'
  ) {
    return response;
  }

  const token = request.cookies.get(sessionCookie)?.value;
  // Signature + expiry only. No database, no network — this is a local verify
  // against the shared secret, so it costs microseconds per request.
  const claims = token ? await verifySession(token) : null;

  if (!claims) {
    if (isLogin) {
      return response;
    }
    if (isApi) {
      return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
    }
    const target = new URL('/login', request.url);
    // Preserve where they were headed so sign-in can return them to it.
    if (path !== '/') {
      target.searchParams.set('next', path);
    }
    return NextResponse.redirect(target);
  }

  if (isLogin) {
    // An ?error= on /login means something upstream deliberately sent the user
    // here to read it. Bouncing them off would loop.
    if (request.nextUrl.searchParams.has('error')) {
      return response;
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}
