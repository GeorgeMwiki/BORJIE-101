/**
 * Supabase env-var accessor for owner-web.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * once and exposes them to client + server code paths. Throws at boot
 * if either is missing so a misconfigured deployment fails fast.
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
      'owner-web: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set',
    );
  }
  cached = { url, anonKey };
  return cached;
}
