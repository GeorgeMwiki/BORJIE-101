import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { refreshSupabaseSession } from './lib/supabase/middleware';
import { getSupabaseEnv } from './lib/supabase/env';

/**
 * Gate every route on a valid Supabase session AND an operator role.
 *
 * On every navigation:
 *   1. Touch the Supabase session via `@supabase/ssr` so the refresh
 *      token rotates and the new access token gets written back into
 *      response cookies.
 *   2. If no session is present and the path is protected, redirect
 *      to `/sign-in?next=<original>` so the user can authenticate and
 *      bounce back.
 *   3. If a session IS present but the principal is NOT a Borjie operator
 *      (platform staff), fail CLOSED with 403 — a tenant-side owner /
 *      manager / buyer who holds a perfectly valid Supabase session must
 *      never reach the internal console. We do NOT redirect them to
 *      `/sign-in` (they already have a session, so that would loop).
 *      Session PRESENCE is authentication, not authorization; this console
 *      is operator-only.
 *
 * Operator identity comes from the SERVER-MANAGED `app_metadata` claim on
 * the verified Supabase JWT — the same trusted source the api-gateway maps
 * (`super_admin` / `borjie_team` → SUPER_ADMIN, plus the platform `admin` /
 * `support` staff roles). `user_metadata` is user-writable and is NEVER
 * trusted for the role decision. Unknown / tenant-only roles (owner,
 * manager, resident, buyer_org_*) fail CLOSED.
 *
 * Defense in depth (CVE-2025-29927): Next.js middleware is NOT a hard
 * authorization boundary — a crafted `x-middleware-subrequest` header can
 * skip it. This gate is the first line; every operator data path is ALSO
 * re-checked server-side at the api-gateway (which enforces SUPER_ADMIN /
 * ADMIN on `/internal/*` and platform routes), so a bypassed middleware
 * cannot read or mutate tenant data — it can at most render an empty shell.
 *
 * Public paths (no session required):
 *   - `/sign-in` — the canonical sign-in form
 *   - `/login` — legacy alias; permanently redirects to `/sign-in`, so it
 *     must stay reachable without a session to emit that redirect cleanly
 *   - `/api/platform/health` — ops liveness probe
 *   - static Next assets — excluded via `config.matcher` below
 */

/**
 * Supabase `app_metadata` role strings that grant access to the Borjie
 * internal console. Mirrors the api-gateway's `ROLE_PRIORITY` operator set
 * (`services/api-gateway/src/auth/supabase/supabase-auth-middleware.ts`):
 * `super_admin` / `borjie_team` are Borjie staff (→ SUPER_ADMIN), and
 * `admin` / `support` are the platform-staff roles the gateway treats as
 * platform principals. Compared case-insensitively. Tenant-side roles
 * (owner, manager, resident, buyer_org_*) are intentionally absent.
 */
const OPERATOR_ROLES: ReadonlySet<string> = new Set([
  'super_admin',
  'borjie_team',
  'admin',
  'support',
]);

/**
 * Extract every role string carried in the verified JWT's TRUSTED
 * `app_metadata`. Reads the same keys the gateway and `StaffIdentityStrip`
 * recognise (`mining_role`, `roles`, `platform_roles`, `role`), accepting
 * either a string or an array. `user_metadata` is deliberately ignored — it
 * is user-writable, so trusting it for authorization would let any signed-in
 * user self-grant operator access.
 */
function readOperatorRoles(
  appMetadata: Record<string, unknown> | undefined,
): ReadonlyArray<string> {
  if (!appMetadata) return [];
  const candidates = [
    appMetadata.mining_role,
    appMetadata.roles,
    appMetadata.platform_roles,
    appMetadata.role,
  ];
  const collected: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      collected.push(candidate);
    } else if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        if (typeof entry === 'string' && entry.length > 0) collected.push(entry);
      }
    }
  }
  return collected;
}

/**
 * Resolve whether the current request's session belongs to a Borjie
 * operator. Builds a read-only Supabase server client over the cookies the
 * refresh step just rotated (so it reads the SAME valid session) and checks
 * the trusted `app_metadata` role claim. Read-only: it never writes cookies
 * — the refresh response from `refreshSupabaseSession` already owns those.
 */
async function isOperatorRequest(request: NextRequest): Promise<boolean> {
  const env = getSupabaseEnv();
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      // No-ops: this client only READS the session; cookie rotation is
      // owned by `refreshSupabaseSession`'s response.
      set(_name: string, _value: string, _options: CookieOptions) {},
      remove(_name: string, _options: CookieOptions) {},
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return false;

  const roles = readOperatorRoles(
    user.app_metadata as Record<string, unknown> | undefined,
  );
  return roles.some((role) => OPERATOR_ROLES.has(role.toLowerCase()));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const isPublicPath =
    pathname === '/sign-in' ||
    pathname === '/login' ||
    pathname === '/api/platform/health' ||
    pathname.startsWith('/api/platform/login');

  const { response, hasSession } = await refreshSupabaseSession(request);

  if (isPublicPath) {
    return response;
  }

  if (!hasSession) {
    const signInUrl = request.nextUrl.clone();
    signInUrl.pathname = '/sign-in';
    signInUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(signInUrl);
  }

  // Authenticated — now authorize. A valid session is necessary but NOT
  // sufficient: only Borjie operators may reach the console.
  const operator = await isOperatorRequest(request);
  if (!operator) {
    // The principal is authenticated but is NOT a Borjie operator. Do NOT
    // redirect to /sign-in — they already hold a valid session, so that
    // would loop. Fail CLOSED with an explicit 403 instead of serving a
    // console shell to a tenant-side user. JSON for API paths; a minimal
    // honest notice for navigations (the console chrome is never rendered).
    const isApiPath = pathname.startsWith('/api/');
    if (isApiPath) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'OPERATOR_REQUIRED',
            message: 'This console is restricted to Borjie operators.',
          },
        },
        { status: 403 },
      );
    }
    return new NextResponse(
      'Operator access required — this console is restricted to Borjie staff.',
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  return response;
}

export const config = {
  // Protect every path except Next internals and static files.
  matcher: ['/((?!_next/|favicon.ico|.*\\..*).*)'],
};
