/**
 * Supabase session-refresh helper used by `src/middleware.ts`.
 *
 * Wraps `@supabase/ssr`'s `createServerClient` against the Next.js
 * `NextRequest` / `NextResponse` cookies API so the session JWT is
 * refreshed on every navigation. Returns the (possibly mutated)
 * response so the caller can chain redirects / further logic.
 *
 * Pattern copied from the official Supabase SSR docs to ensure the
 * refresh-token rotation is handled correctly; do not inline the
 * cookie wiring in `middleware.ts` — it's easy to get the spread
 * order wrong and silently drop session updates.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { getSupabaseEnv } from './env';

interface RefreshResult {
  readonly response: NextResponse;
  readonly hasSession: boolean;
}

export async function refreshSupabaseSession(
  request: NextRequest,
): Promise<RefreshResult> {
  const env = getSupabaseEnv();
  // Forward the request pathname as a header so server components (the root
  // layout) can tell which route is rendering and skip the session-gated
  // `OwnerShell` on public/auth routes like `/sign-in` — without this the
  // shell's `getOwnerSession()` redirects to `/sign-in` even ON `/sign-in`,
  // an infinite loop that makes the cockpit login unreachable.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-borjie-pathname', request.nextUrl.pathname);
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: { headers: requestHeaders } });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: '', ...options });
        response = NextResponse.next({ request: { headers: requestHeaders } });
        response.cookies.set({ name, value: '', ...options });
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  return { response, hasSession: data.user !== null };
}
