/**
 * Supabase env-var accessor for marketing.
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * once and exposes them to client + server code paths. Throws at boot
 * if either is missing so a misconfigured deployment fails fast.
 *
 * Mirrors the owner-web pattern verbatim — the marketing site does not
 * own auth provisioning (that lives in `services/api-gateway`) but it
 * does drive buyer sign-in directly via the Supabase browser client.
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
      'marketing: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set',
    );
  }
  cached = { url, anonKey };
  return cached;
}
