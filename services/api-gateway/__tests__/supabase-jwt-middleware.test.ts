/**
 * Tests for the api-gateway Supabase JWT middleware (Borjie replatform).
 *
 * Covers both signing modes:
 *  - HS256 + shared SUPABASE_JWT_SECRET (legacy / self-hosted)
 *  - ES256 via JWKS (live Borjie project — May 2026 default)
 *
 * Uses jose's SignJWT + an in-process JWKS so no live network call is
 * made. Asserts:
 *  - 401 when no Authorization header
 *  - 401 INVALID_TOKEN on bad signature
 *  - 403 FORBIDDEN when app_metadata.tenant_id is missing
 *  - 403 FORBIDDEN on user_metadata.tenant_id self-promotion attempt
 *  - 200 + AuthContext populated with userId / tenantId / role for HS256
 *  - 200 + AuthContext populated for ES256 via JWKS
 *  - mining_role drives the AuthContext.role mapping when present
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  type JWK,
  createLocalJWKSet,
} from 'jose';

import { supabaseAuthMiddleware } from '../src/auth/supabase/supabase-auth-middleware.js';
import {
  _resetJwksCacheForTests,
  _seedJwksForTests,
} from '../src/auth/supabase/supabase-jwt-verify.js';
import { UserRole } from '../src/types/user-role.js';

const HS256_SECRET = 'borjie-test-secret-must-be-long-enough-for-hs256';
const SUPABASE_URL = 'https://ppkmldyedckdzcqgegmk.supabase.co';
const JWKS_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;

interface ErrorBody {
  readonly error: { readonly code: string };
}

interface AuthBody {
  readonly auth: {
    readonly userId: string;
    readonly tenantId: string;
    readonly role: string;
    readonly email?: string;
  };
}

async function makeHsToken(payload: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(HS256_SECRET);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject((payload['sub'] as string | undefined) ?? 'user-1')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

function buildApp() {
  const app = new Hono();
  app.use('*', supabaseAuthMiddleware);
  app.get('/me', (c) => {
    const auth = c.get('auth');
    return c.json({ ok: true, auth });
  });
  return app;
}

function resetSupabaseEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_JWT_SECRET;
}

describe('supabaseAuthMiddleware (HS256 path)', () => {
  beforeEach(() => {
    resetSupabaseEnv();
    process.env.SUPABASE_JWT_SECRET = HS256_SECRET;
  });
  afterEach(resetSupabaseEnv);

  it('returns 401 UNAUTHORIZED when Authorization header is missing', async () => {
    const app = buildApp();
    const res = await app.request('http://x/me');
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 INVALID_TOKEN when signature is wrong', async () => {
    const app = buildApp();
    const bad = await new SignJWT({
      app_metadata: { tenant_id: 'borjie-demo', mining_role: 'owner' },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('totally-wrong-secret-of-sufficient-length'));
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${bad}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 403 FORBIDDEN when app_metadata.tenant_id is missing', async () => {
    const app = buildApp();
    const token = await makeHsToken({
      app_metadata: { mining_role: 'owner' },
    });
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('blocks a user_metadata tenant_id self-promotion attempt with 403', async () => {
    const app = buildApp();
    const token = await makeHsToken({
      user_metadata: { tenant_id: 'evil-tenant' },
      app_metadata: { tenant_id: 'borjie-demo', mining_role: 'owner' },
    });
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('accepts a valid HS256 token and projects mining_role onto AuthContext.role', async () => {
    const app = buildApp();
    const token = await makeHsToken({
      sub: 'auth-uuid-owner',
      email: 'owner@borjie.dev',
      app_metadata: { tenant_id: 'borjie-demo', mining_role: 'owner' },
      user_metadata: { first_name: 'Mzee', last_name: 'Komba' },
    });
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthBody;
    expect(body.auth.userId).toBe('auth-uuid-owner');
    expect(body.auth.tenantId).toBe('borjie-demo');
    expect(body.auth.role).toBe(UserRole.OWNER);
    expect(body.auth.email).toBe('owner@borjie.dev');
  });

  it('grants SUPER_ADMIN for the borjie_team mining_role', async () => {
    const app = buildApp();
    const token = await makeHsToken({
      sub: 'auth-uuid-admin',
      app_metadata: { tenant_id: 'borjie-demo', mining_role: 'borjie_team' },
    });
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthBody;
    expect(body.auth.role).toBe(UserRole.SUPER_ADMIN);
  });

  it('returns 500 AUTH_PROVIDER_MISCONFIGURED when no verify input is configured', async () => {
    resetSupabaseEnv();
    const app = buildApp();
    const res = await app.request('http://x/me', {
      headers: { Authorization: 'Bearer anything' },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('AUTH_PROVIDER_MISCONFIGURED');
  });
});

describe('supabaseAuthMiddleware (ES256 JWKS path)', () => {
  // Symmetric key types for the in-process JWKS the suite mints.
  let privateKey: CryptoKey;
  let publicJwk: JWK;

  beforeEach(async () => {
    resetSupabaseEnv();
    process.env.SUPABASE_URL = SUPABASE_URL;
    _resetJwksCacheForTests();
    // Mint a fresh ES256 keypair per test so cases stay hermetic.
    const kp = await generateKeyPair('ES256', { extractable: true });
    privateKey = kp.privateKey;
    publicJwk = await exportJWK(kp.publicKey);
    publicJwk.alg = 'ES256';
    publicJwk.use = 'sig';
    publicJwk.kid = 'borjie-test-kid';
    // Bypass the network — wire a local in-memory JWKS for the URL the
    // middleware will look up.
    const getKey = createLocalJWKSet({ keys: [publicJwk] });
    _seedJwksForTests(JWKS_URL, getKey);
  });
  afterEach(() => {
    resetSupabaseEnv();
    _resetJwksCacheForTests();
  });

  async function signEs(payload: Record<string, unknown>): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'ES256', kid: publicJwk.kid })
      .setSubject((payload['sub'] as string | undefined) ?? 'user-es-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  it('verifies an ES256 token via JWKS and populates AuthContext', async () => {
    const app = buildApp();
    const token = await signEs({
      sub: 'auth-uuid-driver',
      email: 'employee@borjie.dev',
      app_metadata: { tenant_id: 'borjie-demo', mining_role: 'driver' },
    });
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthBody;
    expect(body.auth.userId).toBe('auth-uuid-driver');
    expect(body.auth.tenantId).toBe('borjie-demo');
    expect(body.auth.role).toBe(UserRole.MAINTENANCE_STAFF);
    expect(body.auth.email).toBe('employee@borjie.dev');
  });

  it('rejects an ES256 token signed by a different keypair with 401', async () => {
    const app = buildApp();
    const other = await generateKeyPair('ES256', { extractable: true });
    const bad = await new SignJWT({
      sub: 'attacker',
      app_metadata: { tenant_id: 'borjie-demo', mining_role: 'owner' },
    })
      .setProtectedHeader({ alg: 'ES256', kid: 'wrong-kid' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(other.privateKey);
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${bad}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('INVALID_TOKEN');
  });
});
