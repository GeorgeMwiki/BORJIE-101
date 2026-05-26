/**
 * Supabase env-var accessor for admin-web.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * once and exposes them to client + server code paths. Throws a clear
 * error at boot if either is missing so the app fails fast on a
 * misconfigured deployment instead of leaking opaque "fetch failed"
 * errors from the Supabase SDK.
 */

interface SupabaseEnv {
  readonly url: string;
  readonly anonKey: string;
}

let cached: SupabaseEnv | null = null;

export function getSupabaseEnv(): SupabaseEnv {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error(
      'admin-web: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set',
    );
  }
  cached = { url, anonKey };
  return cached;
}
