/**
 * RLS-aware Supabase client factory + api-gateway request helper for the
 * `pnpm live-test` happy-path suite.
 *
 * Why this lives separate from `e2e/fixtures/dual-tenant-fixtures.ts`:
 *
 *   - The dual-tenant fixture is a *cross-tenant deny* suite. It directly
 *     seeds rows via the `postgres` driver (bypasses RLS) so it can prove
 *     tenant-X cannot see tenant-Y. The live-test suite, by contrast,
 *     speaks ONLY through the api-gateway + Supabase Auth — every row is
 *     created by an authenticated client, every RLS predicate fires for
 *     real. That is the point of "live test": no driver-level shortcuts.
 *
 *   - We use the public anon key + the Supabase Auth client (PKCE flow)
 *     so the access_token carries the real `app_metadata.tenant_id` claim
 *     that `current_app_tenant_id()` (the RLS predicate) reads. The
 *     service-role key NEVER appears in this file — it lives in the
 *     api-gateway env and is server-only.
 *
 *   - The `requestAsUser()` helper attaches `Authorization: Bearer <jwt>`
 *     to every api-gateway call so the gateway can verify the token with
 *     `SUPABASE_JWT_SECRET` and project the principal onto the per-request
 *     tenant context (see `packages/ai-copilot/src/config/supabase-auth.ts`).
 *
 * Environment contract (validated in globalSetup):
 *   - NEXT_PUBLIC_SUPABASE_URL  — Supabase project URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY — anon public key (client-safe)
 *   - API_GATEWAY_URL           — api-gateway base URL (default localhost:4000)
 *   - LIVE_TEST_OWNER_EMAIL     — bootstrap owner email
 *   - LIVE_TEST_OWNER_PASSWORD  — bootstrap owner password
 *   - LIVE_TEST_OTHER_EMAIL     — cross-tenant deny user email
 *   - LIVE_TEST_OTHER_PASSWORD  — cross-tenant deny user password
 *
 * NEVER read SUPABASE_SERVICE_ROLE_KEY here — that is exclusively used by
 * server-side admin paths (cleanup of orphaned tenants, etc.) and lives
 * in `cleanup.ts`.
 */
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';

// ============================================================================
// ENVIRONMENT
// ============================================================================

export interface LiveTestEnv {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly apiGatewayUrl: string;
  readonly ownerEmail: string;
  readonly ownerPassword: string;
  readonly otherEmail: string;
  readonly otherPassword: string;
}

/** Read + validate the live-test environment. Throws with a precise error
 *  message naming the missing var when anything is unset. */
export function loadLiveTestEnv(): LiveTestEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const apiGatewayUrl = process.env.API_GATEWAY_URL?.trim() ?? 'http://localhost:4000';
  const ownerEmail = process.env.LIVE_TEST_OWNER_EMAIL?.trim();
  const ownerPassword = process.env.LIVE_TEST_OWNER_PASSWORD?.trim();
  const otherEmail = process.env.LIVE_TEST_OTHER_EMAIL?.trim();
  const otherPassword = process.env.LIVE_TEST_OTHER_PASSWORD?.trim();

  const missing: string[] = [];
  if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!ownerEmail) missing.push('LIVE_TEST_OWNER_EMAIL');
  if (!ownerPassword) missing.push('LIVE_TEST_OWNER_PASSWORD');
  if (!otherEmail) missing.push('LIVE_TEST_OTHER_EMAIL');
  if (!otherPassword) missing.push('LIVE_TEST_OTHER_PASSWORD');

  if (missing.length > 0) {
    throw new Error(
      `live-test env missing: ${missing.join(', ')}. See Docs/RUNBOOKS/live-test.md.`,
    );
  }

  return Object.freeze({
    supabaseUrl: supabaseUrl as string,
    supabaseAnonKey: supabaseAnonKey as string,
    apiGatewayUrl,
    ownerEmail: ownerEmail as string,
    ownerPassword: ownerPassword as string,
    otherEmail: otherEmail as string,
    otherPassword: otherPassword as string,
  });
}

// ============================================================================
// SUPABASE AUTH (REST flow — no @supabase/supabase-js dependency at suite root)
// ============================================================================

/**
 * Sign in via Supabase Auth's `/auth/v1/token?grant_type=password` REST
 * endpoint. We do NOT import `@supabase/supabase-js` here — the live-test
 * suite intentionally keeps zero runtime deps on supabase-js so the
 * Playwright config can be self-contained and run against any
 * Supabase-compatible auth backend (the gateway only cares about the JWT).
 *
 * Returns the access_token (HS256) that the api-gateway will verify with
 * `SUPABASE_JWT_SECRET`.
 */
export async function signInWithPassword(
  env: LiveTestEnv,
  email: string,
  password: string,
): Promise<string> {
  const url = `${env.supabaseUrl}/auth/v1/token?grant_type=password`;
  const ctx = await playwrightRequest.newContext();
  try {
    const resp = await ctx.post(url, {
      headers: {
        apikey: env.supabaseAnonKey,
        'content-type': 'application/json',
      },
      data: { email, password },
      failOnStatusCode: false,
    });
    if (!resp.ok()) {
      const body = await resp.text().catch(() => '');
      throw new Error(
        `Supabase signIn failed for ${email}: ${resp.status()} ${body.slice(0, 200)}`,
      );
    }
    const json = (await resp.json()) as { access_token?: string };
    const token = json?.access_token;
    if (!token || typeof token !== 'string') {
      throw new Error(`Supabase signIn for ${email} returned no access_token`);
    }
    return token;
  } finally {
    await ctx.dispose();
  }
}

// ============================================================================
// API-GATEWAY HELPERS
// ============================================================================

export interface AuthedRequest {
  readonly request: APIRequestContext;
  readonly token: string;
  readonly baseUrl: string;
  dispose(): Promise<void>;
}

/** Create a Playwright APIRequestContext that attaches the Bearer token to
 *  every request. Caller MUST `dispose()` when done. */
export async function authedRequest(
  env: LiveTestEnv,
  token: string,
): Promise<AuthedRequest> {
  const request = await playwrightRequest.newContext({
    baseURL: env.apiGatewayUrl,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
  return {
    request,
    token,
    baseUrl: env.apiGatewayUrl,
    dispose: async () => {
      await request.dispose();
    },
  };
}

/** Try a list of candidate endpoint paths and return the first non-404.
 *  The api-gateway has historically mounted some endpoints under both
 *  `/api/v1/...` and `/api/...` — this helper survives a remount. */
export async function tryPaths(
  authed: AuthedRequest,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  paths: readonly string[],
  body?: unknown,
): Promise<{ status: number; body: unknown; path: string }> {
  let last: { status: number; body: unknown; path: string } | null = null;
  for (const path of paths) {
    const resp = await authed.request.fetch(path, {
      method,
      data: body !== undefined ? body : undefined,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      failOnStatusCode: false,
    });
    const status = resp.status();
    const parsed = await resp.json().catch(() => null);
    last = { status, body: parsed, path };
    if (status !== 404) return last;
  }
  if (!last) throw new Error('tryPaths called with empty paths');
  return last;
}
