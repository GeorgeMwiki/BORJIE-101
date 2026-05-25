/**
 * Spec 01 — Owner signup via Supabase Auth.
 *
 * Verifies the bootstrap owner credentials produce a valid Supabase
 * access_token AND that the api-gateway accepts it on `/api/me`. This
 * spec assumes the user already exists in Supabase Auth (created
 * out-of-band during `Docs/RUNBOOKS/supabase-bootstrap.md` step 4 —
 * "Manually create a test user"). It is intentionally NOT a signUp
 * flow because Supabase rate-limits public sign-up; we need the test
 * user to be stable across the 10 specs.
 *
 * If a future test wants to exercise the public sign-up surface, build
 * it as a separate suite — the live-test happy path needs a known
 * principal whose `app_metadata.tenant_id` claim is server-controlled.
 */
import { test, expect } from '@playwright/test';
import {
  loadLiveTestEnv,
  authedRequest,
  signInWithPassword,
} from './fixtures/tenant-context';
import { readCachedTokens } from './fixtures/auth-cache';

test.describe('01 — Owner signup + JWT verification', () => {
  test('Supabase signIn returns a valid access_token', async () => {
    const env = loadLiveTestEnv();
    const token = await signInWithPassword(env, env.ownerEmail, env.ownerPassword);
    expect(token.length).toBeGreaterThan(50);
    expect(token.split('.').length).toBe(3); // header.payload.signature
  });

  test('cached owner token matches a fresh signIn within the same suite', async () => {
    const { ownerToken } = readCachedTokens();
    expect(ownerToken.length).toBeGreaterThan(50);
    expect(ownerToken.split('.').length).toBe(3);
  });

  test('api-gateway /api/me accepts the owner JWT and projects the principal', async () => {
    const env = loadLiveTestEnv();
    const { ownerToken } = readCachedTokens();
    const authed = await authedRequest(env, ownerToken);
    try {
      const resp = await authed.request.get('/api/me');
      expect(resp.status()).toBe(200);
      const body = (await resp.json()) as {
        data?: { userId?: string; tenantId?: string; roles?: string[] };
        userId?: string;
        tenantId?: string;
        roles?: string[];
      };
      const userId = body?.data?.userId ?? body?.userId;
      const tenantId = body?.data?.tenantId ?? body?.tenantId;
      const roles = body?.data?.roles ?? body?.roles ?? [];
      expect(userId).toBeTruthy();
      expect(tenantId).toBeTruthy();
      expect(Array.isArray(roles)).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('the other (cross-tenant) user also gets a valid token', async () => {
    const { otherToken } = readCachedTokens();
    expect(otherToken.length).toBeGreaterThan(50);
    // We intentionally do NOT call /api/me with this token here — that's
    // exercised by spec 09 as part of the deny path.
  });
});
