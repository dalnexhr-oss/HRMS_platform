// Verify JWT signatures at the edge and route unauthenticated requests to login. Server session
// checks enforce revocation; layouts and repository policies enforce authorization.
import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth/jwt';
import { apiErrorCodes, notSignedInMessage } from '@/lib/api/errors';
import { sessionCookie } from '@/lib/auth/session-shared';
import type { NextRequest } from 'next/server';

async function updateSession(request: NextRequest) {
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

  // Cron and the terminal bridge authenticate with their own bearer secrets, without a browser
  // session. Their endpoints refuse requests when their respective secrets are unset.
  if (
    path === '/api/cron' ||
    path.startsWith('/api/cron/') ||
    path === '/api/devices/zkteco/punch'
  ) {
    return response;
  }

  // /auth/* handles its own flows (password reset, invite acceptance) and
  // writes cookies itself. Gating it here would abort those.
  if (isAuthRoute) {
    return response;
  }

  // Skip background link prefetching to keep page loads fast; full access checks run on actual navigation.
  if (
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch'
  ) {
    return response;
  }

  const token = request.cookies.get(sessionCookie)?.value;
  // Quickly verify token signature and expiry without making database calls.
  const claims = token ? await verifySession(token) : null;

  if (!claims) {
    if (isLogin) {
      return response;
    }
    if (isApi) {
      return NextResponse.json(
        { error: notSignedInMessage, code: apiErrorCodes.notSignedIn },
        { status: 401 },
      );
    }
    const target = new URL('/login', request.url);
    // Preserve where they were headed so sign-in can return them to it.
    if (path !== '/') {
      target.searchParams.set('next', `${path}${request.nextUrl.search}`);
    }
    return NextResponse.redirect(target);
  }

  if (isLogin) {
    // If the login page is displaying an error message, stay on the page so the user can read it.
    if (request.nextUrl.searchParams.has('error')) {
      return response;
    }
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}

export { updateSession };
