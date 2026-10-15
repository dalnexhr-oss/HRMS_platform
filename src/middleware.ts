import { updateSession } from '@/lib/auth/middleware';
import type { NextRequest } from 'next/server';

async function middleware(request: NextRequest) {
  return await updateSession(request);
}

// The middleware runs on all pages except the static assets and the favicon. The static assets are
// served from the _next/static and _next/image paths, and the favicon is at /favicon.ico. The
// matcher uses a negative lookahead to exclude these paths.

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

export { middleware };
