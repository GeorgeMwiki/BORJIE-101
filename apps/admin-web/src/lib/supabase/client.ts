/**
 * Browser-side Supabase client for admin-web.
 *
 * Uses `@supabase/ssr`'s `createBrowserClient` so the session is
 * persisted into cookies that the server-side `createServerClient`
 * and Next.js middleware can both read. Always use this from client
 * components; the server-side equivalent lives in `./server.ts`.
 */

'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseEnv } from './env';

let singleton: SupabaseClient | null = null;

export function createSupabaseBrowserClient(): SupabaseClient {
  if (singleton) return singleton;
  const env = getSupabaseEnv();
  singleton = createBrowserClient(env.url, env.anonKey);
  return singleton;
}
