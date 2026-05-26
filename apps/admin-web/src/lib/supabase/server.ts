/**
 * Server-side Supabase client for admin-web.
 *
 * Uses Next.js `cookies()` to read/write the Supabase session, so RSC
 * loaders, route handlers, and server actions all see the same session
 * cookies as the browser. Returns a fresh client per call — Next.js
 * caches the cookies() store per-request, so reusing across requests
 * would leak sessions between users.
 *
 * Wraps the cookie writes in try/catch because RSC render passes
 * cannot mutate cookies; the SDK still calls `set` defensively on
 * refresh, and silencing the error there is the documented pattern.
 */

import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from './env';

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const env = getSupabaseEnv();
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      get(name: string) {
        return store.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          store.set({ name, value, ...options });
        } catch {
          // RSC render context — cookies are read-only.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          store.set({ name, value: '', ...options });
        } catch {
          // RSC render context — cookies are read-only.
        }
      },
    },
  });
}
