import { NextResponse, type NextRequest } from 'next/server';

import { refreshSupabaseSession } from './lib/supabase/middleware';

/**
 * Gate every route on a valid Supabase session.
 *
 * On every navigation:
 *   1. Touch the Supabase session via `@supabase/ssr` so the refresh
 *      token rotates and the new access token is written back into
 *      response cookies.
 *   2. If no session is present and the path is protected, redirect
 *      to `/sign-in?next=<original>` so the user authenticates and
 *      bounces back.
 *
 * Public paths (no session required):
 *   - `/sign-in` — the sign-in form itself
 *   - static Next assets — excluded via `config.matcher` below
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isPublicPath = pathname === '/sign-in';

  const { response, hasSession } = await refreshSupabaseSession(request);

  if (isPublicPath) {
    return response;
  }

  if (hasSession) {
    return response;
  }

  const signInUrl = request.nextUrl.clone();
  signInUrl.pathname = '/sign-in';
  signInUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(signInUrl);
}

export const config = {
  // Protect every path except Next internals and static files.
  matcher: ['/((?!_next/|favicon.ico|.*\\..*).*)'],
};
