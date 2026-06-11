/**
 * SEC-G2 — `hono-auth` iss/aud + app_metadata-only hardening.
 *
 * The production ES256 path verifies against a remote JWKS, which needs a
 * network endpoint. We mock `jose` so the test is deterministic: the mock
 * `jwtVerify` enforces the `issuer` / `audience` options exactly the way
 * jose does (throwing on mismatch), and returns a controllable payload.
 * That lets us assert the middleware's behaviour without a live Supabase.
 *
 * Coverage:
 *   - valid token from the configured issuer + aud=authenticated → 200.
 *   - same token with a DIFFERENT iss → 401 (cross-project rejection).
 *   - aud != 'authenticated' → 401.
 *   - tenant_id only in user_metadata → 401 (app_metadata-only rule).
 *   - legacy HS256 gateway path still works (no behaviour change).
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import type { MiddlewareHandler } from 'hono';

const SUPABASE_URL = 'https://proj123.supabase.co';
const SUPABASE_ISSUER = `${SUPABASE_URL}/auth/v1`;
const GATEWAY_SECRET = 'gateway-test-secret-1234567890-min32chars';

// `vi.hoisted` runs BEFORE the (hoisted) ESM imports, so the middleware's
// module-load `getJwtSecret()` + `SUPABASE_URL` reads see these values. A
// plain top-level `process.env.X = ...` would run AFTER the import is
// evaluated and the secret would already be captured wrong.
vi.hoisted(() => {
  process.env.SUPABASE_URL = 'https://proj123.supabase.co';
  process.env.JWT_ACCESS_SECRET = 'gateway-test-secret-1234567890-min32chars';
  process.env.JWT_SECRET = 'gateway-test-secret-1234567890-min32chars';
  process.env.BORJIE_JWT_ISS_AUD = 'on';
});

// Mock jose: jwtVerify enforces iss/aud like the real lib; createRemoteJWKSet
// returns a sentinel so SUPABASE_JWKS is non-null and the ES256 branch runs.
const { verifyImpl } = vi.hoisted(() => ({ verifyImpl: vi.fn() }));
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({ __jwks: true }),
  jwtVerify: (...args: unknown[]) => verifyImpl(...args),
}));

// Mock the role mapper to avoid pulling the supabase auth module graph.
vi.mock('../../auth/supabase/supabase-auth-middleware', () => ({
  mapSupabaseRolesToUserRole: () => 'RESIDENT',
}));

// Loaded in beforeAll AFTER the hoisted env is applied.
let authMiddleware: MiddlewareHandler;

/** Build a fake ES256 token: only the header alg matters to the router. */
function fakeEs256Token(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify({ sub: 'u1' })).toString('base64url');
  return `${header}.${body}.sig`;
}

function makeApp() {
  const app = new Hono();
  app.use('/probe', authMiddleware);
  app.get('/probe', (c) => c.json({ auth: c.get('auth') }));
  return app;
}

/**
 * Emulate jose.jwtVerify: throw on iss/aud mismatch (like JWTClaimValidation
 * Failed), otherwise return `{ payload }`.
 */
function setVerifyPayload(
  payload: Record<string, unknown>,
  claims: { iss: string; aud: string },
): void {
  verifyImpl.mockImplementation(
    async (_token: string, _jwks: unknown, opts?: { issuer?: string; audience?: string }) => {
      if (opts?.issuer !== undefined && opts.issuer !== claims.iss) {
        throw new Error('JWTClaimValidationFailed: unexpected "iss" claim value');
      }
      if (opts?.audience !== undefined && opts.audience !== claims.aud) {
        throw new Error('JWTClaimValidationFailed: unexpected "aud" claim value');
      }
      return { payload };
    },
  );
}

describe('hono-auth — iss/aud enforcement (SEC-G2)', () => {
  beforeAll(async () => {
    verifyImpl.mockReset();
    ({ authMiddleware } = await import('../hono-auth'));
  });

  it('accepts a token from the configured issuer with aud=authenticated', async () => {
    setVerifyPayload(
      { sub: 'sb-1', app_metadata: { tenant_id: 't-1', mining_role: 'OWNER' }, exp: 9_999_999_999 },
      { iss: SUPABASE_ISSUER, aud: 'authenticated' },
    );
    const res = await makeApp().request('/probe', {
      headers: { Authorization: `Bearer ${fakeEs256Token()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: { tenantId: string } };
    expect(body.auth.tenantId).toBe('t-1');
  });

  it('rejects a token whose iss is a different Supabase project', async () => {
    // The token's real claims carry a foreign issuer; the middleware passes
    // SUPABASE_ISSUER as the expected issuer, so the mock throws → 401.
    setVerifyPayload(
      { sub: 'sb-2', app_metadata: { tenant_id: 't-2' } },
      { iss: 'https://attacker.supabase.co/auth/v1', aud: 'authenticated' },
    );
    const res = await makeApp().request('/probe', {
      headers: { Authorization: `Bearer ${fakeEs256Token()}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects a token with aud != authenticated', async () => {
    setVerifyPayload(
      { sub: 'sb-3', app_metadata: { tenant_id: 't-3' } },
      { iss: SUPABASE_ISSUER, aud: 'anon' },
    );
    const res = await makeApp().request('/probe', {
      headers: { Authorization: `Bearer ${fakeEs256Token()}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a token whose tenant_id only lives in user_metadata', async () => {
    setVerifyPayload(
      { sub: 'sb-4', user_metadata: { tenant_id: 'forged' } },
      { iss: SUPABASE_ISSUER, aud: 'authenticated' },
    );
    const res = await makeApp().request('/probe', {
      headers: { Authorization: `Bearer ${fakeEs256Token()}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  it('legacy HS256 gateway path is unchanged', async () => {
    const token = jwt.sign(
      { userId: 'gw-1', tenantId: 'gw-t', role: 'RESIDENT', permissions: [], propertyAccess: [] },
      GATEWAY_SECRET,
      { algorithm: 'HS256' },
    );
    const res = await makeApp().request('/probe', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: { userId: string; tenantId: string } };
    expect(body.auth.userId).toBe('gw-1');
    expect(body.auth.tenantId).toBe('gw-t');
  });
});
