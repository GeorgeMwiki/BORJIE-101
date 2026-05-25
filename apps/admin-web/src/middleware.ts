import { NextResponse, type NextRequest } from 'next/server';

import { PLATFORM_SESSION_COOKIE } from './lib/session';

/**
 * Gate every route on a valid platform-staff session cookie.
 *
 * Exemptions:
 *   - `/login` — where staff obtain a session
 *   - `/api/platform/health` — liveness probe for the ops mesh
 *   - `/api/platform/login` — the login route itself (must be reachable
 *     pre-auth so the login form can POST)
 *   - static Next assets (excluded via matcher below)
 *
 * When the cookie is missing on a protected path, users are redirected
 * to `/login` with a `next=` param so we can bounce them back after auth.
 *
 * Cookie presence alone is not authentication — the identity service
 * still validates the token on every request (see `src/lib/session.ts`).
 */
export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isPublicPath =
    pathname === '/login' ||
    pathname === '/api/platform/health' ||
    pathname === '/api/platform/login';

  if (isPublicPath) {
    return NextResponse.next();
  }

  const session = request.cookies.get(PLATFORM_SESSION_COOKIE)?.value;
  if (session && session.length > 0) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Protect every path except Next internals and static files.
  matcher: ['/((?!_next/|favicon.ico|.*\\..*).*)'],
};
