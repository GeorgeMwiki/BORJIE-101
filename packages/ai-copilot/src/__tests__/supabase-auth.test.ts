/**
 * Supabase JWT verification tests.
 *
 * These tests use jose to mint a real HS256 JWT with a known secret, verify
 * it through `verifySupabaseJwt`, and assert the projected principal +
 * Brain contexts. No fakes — actual cryptographic verify path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import {
  verifySupabaseJwt,
  extractBearer,
  principalToBrainContexts,
  SupabaseAuthError,
  loadBrainEnv,
  tryLoadBrainEnv,
  BrainConfigError,
} from '../config/index.js';
import {
  _resetJwksCacheForTests,
  _seedJwksForTests,
  _createLocalJwksForTests,
} from '../config/supabase-auth.js';
import { logger } from '../logger.js';

const SECRET = 'test-secret-for-jwt-verification-1234567890';
const enc = new TextEncoder().encode(SECRET);

async function mintToken(claims: Record<string, unknown>) {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setSubject(String(claims.sub ?? 'user-1'))
    .sign(enc);
}

describe('extractBearer', () => {
  it('extracts a Bearer token from a header value', () => {
    expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });
  it('returns null for missing or malformed', () => {
    expect(extractBearer(null)).toBeNull();
    expect(extractBearer('Basic xyz')).toBeNull();
    expect(extractBearer('')).toBeNull();
  });
});

describe('verifySupabaseJwt', () => {
  it('verifies a well-formed token with app_metadata.tenant_id', async () => {
    const token = await mintToken({
      sub: 'user-42',
      email: 'asha@kilimani.com',
      app_metadata: {
        tenant_id: 'tenant-1',
        tenant_name: 'Kilimani Heights',
        roles: ['admin', 'manager'],
        team_ids: ['leasing-1'],
        environment: 'production',
      },
    });
    const principal = await verifySupabaseJwt(token, { jwtSecret: SECRET });
    expect(principal.userId).toBe('user-42');
    expect(principal.tenantId).toBe('tenant-1');
    expect(principal.tenantName).toBe('Kilimani Heights');
    expect(principal.roles).toEqual(['admin', 'manager']);
    expect(principal.teamIds).toEqual(['leasing-1']);
    expect(principal.environment).toBe('production');
  });

  it('rejects with 403 when no tenant claim is present', async () => {
    const token = await mintToken({ sub: 'user-x' });
    await expect(
      verifySupabaseJwt(token, { jwtSecret: SECRET })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects with 401 on bad signature', async () => {
    const token = await mintToken({
      sub: 'user-9',
      app_metadata: { tenant_id: 't1' },
    });
    await expect(
      verifySupabaseJwt(token, { jwtSecret: 'wrong-secret-dont-match' })
    ).rejects.toThrow(SupabaseAuthError);
  });

  it('rejects with 401 on missing token', async () => {
    await expect(
      verifySupabaseJwt('', { jwtSecret: SECRET })
    ).rejects.toMatchObject({ status: 401 });
  });
});

// ---------------------------------------------------------------------------
// F9 (BORJIE101 Supabase audit):
// `SupabaseAuthError` must NOT leak jose's granular failure detail (signature
// vs expiry vs alg) in production — that detail is an oracle for attackers.
// In non-production envs the verbose detail is retained so developers and
// integration tests can introspect the failure reason.
// ---------------------------------------------------------------------------
describe('F9: jose error detail leak', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    vi.restoreAllMocks();
  });

  it('production: bad signature → generic invalid_token (no jose detail)', async () => {
    process.env.NODE_ENV = 'production';
    // supabase-auth routes server-side detail through the pino-backed `logger`
    // (see packages/ai-copilot/src/logger.ts). The previous version of this
    // test spied on `console.error` and broke once the package adopted pino.
    const loggerErrSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const token = await mintToken({
      sub: 'user-9',
      app_metadata: { tenant_id: 't1' },
    });
    let caught: SupabaseAuthError | null = null;
    try {
      await verifySupabaseJwt(token, {
        jwtSecret: 'wrong-secret-dont-match',
      });
    } catch (err) {
      caught = err as SupabaseAuthError;
    }
    expect(caught).toBeInstanceOf(SupabaseAuthError);
    expect(caught?.status).toBe(401);
    // The generic constant — must NOT include any jose-surfaced phrase
    // like "signature verification" or "JWSSignatureVerificationFailed".
    expect(caught?.message).toBe('invalid_token');
    expect(caught?.message).not.toMatch(/signature/i);
    expect(caught?.message).not.toMatch(/jose/i);
    expect(caught?.message).not.toMatch(/exp/i);
    // Server-side logging must still emit the detail for triage.
    expect(loggerErrSpy).toHaveBeenCalled();
    const logArg = loggerErrSpy.mock.calls[0]?.[0];
    expect(String(logArg)).toMatch(/token rejected/i);
  });

  it('production: expired token → generic invalid_token (no exp detail)', async () => {
    process.env.NODE_ENV = 'production';
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    // Mint a token that's already expired
    const expired = await new SignJWT({
      sub: 'user-x',
      app_metadata: { tenant_id: 't1' },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(enc);
    let caught: SupabaseAuthError | null = null;
    try {
      await verifySupabaseJwt(expired, { jwtSecret: SECRET });
    } catch (err) {
      caught = err as SupabaseAuthError;
    }
    expect(caught?.message).toBe('invalid_token');
    expect(caught?.message).not.toMatch(/exp/i);
    expect(caught?.message).not.toMatch(/expired/i);
  });

  it('test env: bad signature → verbose detail preserved for triage', async () => {
    process.env.NODE_ENV = 'test';
    const token = await mintToken({
      sub: 'user-9',
      app_metadata: { tenant_id: 't1' },
    });
    let caught: SupabaseAuthError | null = null;
    try {
      await verifySupabaseJwt(token, {
        jwtSecret: 'wrong-secret-dont-match',
      });
    } catch (err) {
      caught = err as SupabaseAuthError;
    }
    expect(caught).toBeInstanceOf(SupabaseAuthError);
    expect(caught?.message).toMatch(/^invalid_token:/);
    // jose's underlying message — exact wording can change across
    // versions but the prefix `invalid_token:` plus SOME detail must be present.
    expect(caught?.message.length).toBeGreaterThan('invalid_token:'.length + 5);
  });

  it('development env: bad signature → verbose detail preserved', async () => {
    process.env.NODE_ENV = 'development';
    const token = await mintToken({
      sub: 'user-9',
      app_metadata: { tenant_id: 't1' },
    });
    let caught: SupabaseAuthError | null = null;
    try {
      await verifySupabaseJwt(token, {
        jwtSecret: 'wrong-secret-dont-match',
      });
    } catch (err) {
      caught = err as SupabaseAuthError;
    }
    expect(caught?.message).toMatch(/^invalid_token:/);
  });
});

// ---------------------------------------------------------------------------
// F6 (BORJIE101 Supabase audit):
// tenant_id MUST come from app_metadata (server-set, immutable). It MUST NOT
// be sourced from user_metadata (client-mutable). A malicious user editing
// their own Supabase profile must not be able to self-promote into another
// tenant.
// ---------------------------------------------------------------------------
describe('F6: tenant_id self-promotion via user_metadata', () => {
  // supabase-auth uses the pino-backed `logger` (see ../logger.ts), not
  // `console.error`. The previous spy on `console.error` silently missed
  // every SECURITY event the verifier emitted. See issue #28.
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('accepts a token with only app_metadata.tenant_id (legitimate)', async () => {
    const token = await mintToken({
      sub: 'user-f6-1',
      app_metadata: { tenant_id: 'tnt_a' },
    });
    const p = await verifySupabaseJwt(token, { jwtSecret: SECRET });
    expect(p.tenantId).toBe('tnt_a');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('rejects when app_metadata is empty and tenant_id is only in user_metadata (no client trust)', async () => {
    const token = await mintToken({
      sub: 'user-f6-2',
      app_metadata: {},
      user_metadata: { tenant_id: 'tnt_b' },
    });
    await expect(
      verifySupabaseJwt(token, { jwtSecret: SECRET })
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('missing_tenant'),
    });
  });

  it('rejects with SECURITY log when user_metadata.tenant_id disagrees with app_metadata.tenant_id', async () => {
    const token = await mintToken({
      sub: 'user-f6-3',
      app_metadata: { tenant_id: 'tnt_a' },
      user_metadata: { tenant_id: 'tnt_b' },
    });
    await expect(
      verifySupabaseJwt(token, { jwtSecret: SECRET })
    ).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('tenant_mismatch'),
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [msg, payload] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain('[SECURITY]');
    expect(msg).toContain('self-promotion');
    expect(payload).toMatchObject({
      severity: 'SECURITY',
      event: 'tenant_id_self_promotion_attempt',
      userId: 'user-f6-3',
      appTenantId: 'tnt_a',
      userMetadataTenantId: 'tnt_b',
    });
  });

  it('accepts when user_metadata.tenant_id matches app_metadata.tenant_id (legitimate sync state)', async () => {
    const token = await mintToken({
      sub: 'user-f6-4',
      app_metadata: { tenant_id: 'tnt_a' },
      user_metadata: { tenant_id: 'tnt_a' },
    });
    const p = await verifySupabaseJwt(token, { jwtSecret: SECRET });
    expect(p.tenantId).toBe('tnt_a');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// MAY-2026: BORJIE primary Supabase rotated to ES256 (asymmetric) signing
// via JWKS. The HS256 path stays as a legacy fallback. These tests cover the
// JWKS path with a real ES256 keypair + a mocked fetch returning the JWKS.
// ---------------------------------------------------------------------------
describe('verifySupabaseJwt — JWKS / ES256 path', () => {
  const JWKS_URL = 'https://test-supabase.example.com/auth/v1/.well-known/jwks.json';

  beforeEach(() => {
    _resetJwksCacheForTests();
  });

  afterEach(() => {
    _resetJwksCacheForTests();
  });

  async function mintEs256(
    claims: Record<string, unknown>
  ): Promise<{ token: string; jwks: { keys: unknown[] } }> {
    const { publicKey, privateKey } = await generateKeyPair('ES256', {
      extractable: true,
    });
    const pubJwk = await exportJWK(publicKey);
    pubJwk.alg = 'ES256';
    pubJwk.kid = 'test-key-1';
    pubJwk.use = 'sig';
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key-1' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .setSubject(String(claims.sub ?? 'user-1'))
      .sign(privateKey);
    return { token, jwks: { keys: [pubJwk] } };
  }

  it('verifies a well-formed ES256 token via JWKS', async () => {
    const { token, jwks } = await mintEs256({
      sub: 'user-jwks-1',
      email: 'asha@kilimani.com',
      app_metadata: {
        tenant_id: 'tnt_jwks',
        roles: ['admin'],
      },
    });
    const getter = await _createLocalJwksForTests({
      keys: jwks.keys as Parameters<typeof _createLocalJwksForTests>[0]['keys'],
    });
    _seedJwksForTests(JWKS_URL, getter);
    const p = await verifySupabaseJwt(token, { jwksUrl: JWKS_URL });
    expect(p.userId).toBe('user-jwks-1');
    expect(p.tenantId).toBe('tnt_jwks');
    expect(p.roles).toEqual(['admin']);
  });

  it('rejects an ES256 token signed by a different key', async () => {
    // Mint a token with key A, but seed key B's JWKS — signature must fail.
    const { token: tokenA } = await mintEs256({
      sub: 'user-jwks-bad',
      app_metadata: { tenant_id: 'tnt_x' },
    });
    const { jwks: jwksB } = await mintEs256({ sub: 'unrelated' });
    const getter = await _createLocalJwksForTests({
      keys: jwksB.keys as Parameters<typeof _createLocalJwksForTests>[0]['keys'],
    });
    _seedJwksForTests(JWKS_URL, getter);
    await expect(
      verifySupabaseJwt(tokenA, { jwksUrl: JWKS_URL })
    ).rejects.toThrow(SupabaseAuthError);
  });

  it('rejects when neither jwtSecret nor jwksUrl is provided', async () => {
    const { token } = await mintEs256({
      sub: 'user-misconfig',
      app_metadata: { tenant_id: 'tnt_z' },
    });
    await expect(
      verifySupabaseJwt(token, {} as unknown as { jwtSecret: string })
    ).rejects.toThrow(SupabaseAuthError);
  });

  it('JWKS path wins when both jwtSecret and jwksUrl are provided', async () => {
    // The token is ES256-signed; HS256 secret would not verify it.
    // If the verifier mistakenly took the HS256 path it would fail; instead
    // jwksUrl should take precedence and succeed.
    const { token, jwks } = await mintEs256({
      sub: 'user-pref',
      app_metadata: { tenant_id: 'tnt_pref' },
    });
    const getter = await _createLocalJwksForTests({
      keys: jwks.keys as Parameters<typeof _createLocalJwksForTests>[0]['keys'],
    });
    _seedJwksForTests(JWKS_URL, getter);
    const p = await verifySupabaseJwt(token, {
      jwksUrl: JWKS_URL,
      jwtSecret: 'ignored-because-jwks-wins',
    });
    expect(p.userId).toBe('user-pref');
  });
});

describe('principalToBrainContexts', () => {
  it('marks admin and computes management flag', async () => {
    const token = await mintToken({
      sub: 'u1',
      app_metadata: { tenant_id: 't1', roles: ['admin'] },
    });
    const p = await verifySupabaseJwt(token, { jwtSecret: SECRET });
    const ctx = principalToBrainContexts(p);
    expect(ctx.viewer.isAdmin).toBe(true);
    expect(ctx.viewer.isManagement).toBe(true);
  });
  it('marks team_leader as management without admin', async () => {
    const token = await mintToken({
      sub: 'u2',
      app_metadata: { tenant_id: 't1', roles: ['team_leader'] },
    });
    const p = await verifySupabaseJwt(token, { jwtSecret: SECRET });
    const ctx = principalToBrainContexts(p);
    expect(ctx.viewer.isAdmin).toBe(false);
    expect(ctx.viewer.isManagement).toBe(true);
  });
  it('plain employee is neither admin nor management', async () => {
    const token = await mintToken({
      sub: 'u3',
      app_metadata: { tenant_id: 't1', roles: ['employee'] },
    });
    const p = await verifySupabaseJwt(token, { jwtSecret: SECRET });
    const ctx = principalToBrainContexts(p);
    expect(ctx.viewer.isAdmin).toBe(false);
    expect(ctx.viewer.isManagement).toBe(false);
  });
});

describe('Brain env loader', () => {
  it('throws BrainConfigError when required env is missing', () => {
    expect(() => loadBrainEnv({})).toThrow(BrainConfigError);
  });

  it('tryLoadBrainEnv returns null when env is missing', () => {
    expect(tryLoadBrainEnv({})).toBeNull();
  });

  it('passes when all required env is present', () => {
    const ok = loadBrainEnv({
      ANTHROPIC_API_KEY: 'sk-ant-test-12345',
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon-key-12345',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-12345',
      SUPABASE_JWT_SECRET: 'jwt-secret-1234567890',
      DATABASE_URL: 'postgresql://x:y@host:5432/db',
    } as unknown as NodeJS.ProcessEnv);
    expect(ok.ANTHROPIC_API_KEY).toBe('sk-ant-test-12345');
  });
});
