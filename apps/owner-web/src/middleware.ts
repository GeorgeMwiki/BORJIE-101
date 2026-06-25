import { NextResponse, type NextRequest } from 'next/server';

import { refreshSupabaseSession } from './lib/supabase/middleware';
import { requirePublicBaseUrl } from './lib/env-guard';

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
 * SCOPE OF THIS GATE — AUTHENTICATION ONLY, NOT AUTHORIZATION.
 * The middleware proves a session EXISTS; it does NOT prove the actor owns
 * the owner cockpit. Role authorization (owner-class `mining_role` only) is
 * enforced in `lib/session.ts` `getOwnerSession`, which re-verifies the JWT
 * via `auth.getUser()` and fails CLOSED on a non-owner role. That is the
 * authoritative, re-invoked guard — the role check is deliberately NOT done
 * here because middleware would have to re-decode an unverified token. Do not
 * treat "passed middleware" as "is an owner".
 *
 * Public paths (no session required):
 *   - `/sign-in` — the sign-in form itself
 *   - static Next assets — excluded via `config.matcher` below
 *
 * Outward dedupe redirect (handled before any session work so it never
 * touches the owner shell's auth gate):
 *   - `/signup` — owner self-serve sign-up is deduped to the canonical
 *     marketing `/sign-up` (the known-working, end-to-end path).
 *     Mirrors how marketing `/sign-in` redirects to owner-web
 *     `/sign-in`. Done here in middleware — not in the page — because
 *     the root layout's `OwnerShell` resolves the owner session on
 *     every render and would otherwise bounce an unauthenticated
 *     visitor to `/sign-in` before the page's own redirect runs.
 */
const PUBLIC_PATHS: readonly string[] = ['/sign-in'];

/**
 * Resolve the canonical marketing origin for the `/signup` dedupe
 * redirect. `requirePublicBaseUrl` throws in production when
 * `NEXT_PUBLIC_MARKETING_ORIGIN` is unset (so the deployed cockpit can
 * never silently bounce to localhost); in dev it falls back to
 * http://localhost:3002.
 */
function marketingSignUpUrl(): string {
  const origin = requirePublicBaseUrl(
    'NEXT_PUBLIC_MARKETING_ORIGIN',
    'http://localhost:3002',
  ).replace(/\/$/, '');
  return `${origin}/sign-up`;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === '/signup') {
    return NextResponse.redirect(marketingSignUpUrl());
  }

  const isPublicPath = PUBLIC_PATHS.includes(pathname);

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
