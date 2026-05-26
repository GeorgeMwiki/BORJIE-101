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
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: '', ...options });
        response = NextResponse.next({ request: { headers: request.headers } });
        response.cookies.set({ name, value: '', ...options });
      },
    },
  });

  // Touch the session — triggers refresh-token rotation when needed.
  const { data } = await supabase.auth.getUser();
  return { response, hasSession: data.user !== null };
}
