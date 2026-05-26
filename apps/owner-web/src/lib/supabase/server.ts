/**
 * Server-side Supabase client for owner-web.
 *
 * Uses Next.js `cookies()` to read/write the Supabase session so RSC
 * loaders, route handlers, and server actions all see the same
 * session as the browser. Returns a fresh client per call — cookies()
 * is request-scoped, so reusing across requests would leak sessions.
 *
 * Wraps the cookie writes in try/catch because RSC render passes are
 * read-only; the SDK still calls `set` defensively on refresh and
 * silencing the error there is the documented Supabase pattern.
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
