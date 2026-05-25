/**
 * Auth middleware unit tests — dual-path verification (audit F1 + F6).
 *
 * Coverage:
 *  - Gateway-issued JWT (HS256, signed with JWT_ACCESS_SECRET) — accepted.
 *  - Supabase token with valid sig + app_metadata.tenant_id — accepted.
 *  - Supabase token with valid sig but no tenant claim — 401.
 *  - Supabase token with valid sig but tenant_id only in user_metadata — 401
 *    (F6 protection: user_metadata is client-modifiable, not trusted).
 *  - Malformed token — 401.
 *  - Issuer-routing helpers — pure-function coverage.
 *  - Audit-log emission carries `auth_path` for SOC visibility.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { SignJWT } from 'jose';

const SUPABASE_SECRET = 'supabase-test-secret-1234567890-min32chars';
const GATEWAY_SECRET = 'gateway-test-secret-1234567890-min32chars';
const GATEWAY_REFRESH = 'gateway-refresh-secret-1234567890-min32';

// Env must be set BEFORE the middleware module loads (top-level reads).
process.env.JWT_ACCESS_SECRET = GATEWAY_SECRET;
process.env.JWT_SECRET = GATEWAY_SECRET;
process.env.JWT_REFRESH_SECRET = GATEWAY_REFRESH;
process.env.JWT_ISSUER = 'borjie';
process.env.JWT_AUDIENCE = 'borjie-api';
process.env.SUPABASE_JWT_SECRET = SUPABASE_SECRET;

// Now import the middleware (after env is set).
// Imports must follow env mutation above so the middleware reads test secrets.
import {
  authMiddleware,
  peekJwtClaims,
  looksLikeSupabaseToken,
  extractBearerToken,
  type AuthContext,
} from '../auth.middleware';

const supabaseSecretBytes = new TextEncoder().encode(SUPABASE_SECRET);

async function mintSupabaseToken(
  claims: Record<string, unknown>,
  opts: { secret?: Uint8Array } = {}
): Promise<string> {
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('https://abc123.supabase.co/auth/v1')
    .setExpirationTime('1h')
    .setSubject(String(claims.sub ?? 'user-1'))
    .sign(opts.secret ?? supabaseSecretBytes);
}

function mintGatewayToken(payload: Record<string, unknown>): string {
  return jwt.sign(
    {
      userId: payload.userId ?? 'gw-user-1',
      tenantId: payload.tenantId ?? 'gw-tenant-1',
      role: payload.role ?? 'RESIDENT',
      email: payload.email,
      permissions: payload.permissions ?? [],
      propertyAccess: payload.propertyAccess ?? [],
      sessionId: payload.sessionId,
    },
    GATEWAY_SECRET,
    {
      issuer: 'borjie',
      audience: 'borjie-api',
      subject: String(payload.userId ?? 'gw-user-1'),
      expiresIn: '15m',
      algorithm: 'HS256',
    }
  );
}

/**
 * Spin up a tiny Hono app that mounts authMiddleware and echoes the
 * resolved auth context. This is the only way to drive the middleware
 * end-to-end without depending on the full gateway server.
 */
function makeAuthProbeApp() {
  const app = new Hono();
  app.use('/probe', authMiddleware);
  app.get('/probe', (c) => {
    const auth = c.get('auth') as AuthContext | undefined;
    return c.json({ auth });
  });
  return app;
}

describe('peekJwtClaims', () => {
  it('returns iss and hasAppMetadata for a Supabase-shaped token', async () => {
    const token = await mintSupabaseToken({
      sub: 'u1',
      app_metadata: { tenant_id: 't1' },
    });
    const peeked = peekJwtClaims(token);
    expect(peeked).not.toBeNull();
    expect(peeked!.iss).toContain('supabase.co');
    expect(peeked!.hasAppMetadata).toBe(true);
  });

  it('returns hasAppMetadata=false for a gateway-shaped token', () => {
    const token = mintGatewayToken({ userId: 'u1', tenantId: 't1' });
    const peeked = peekJwtClaims(token);
    expect(peeked).not.toBeNull();
    expect(peeked!.iss).toBe('borjie');
    expect(peeked!.hasAppMetadata).toBe(false);
  });

  it('returns null for a malformed token', () => {
    expect(peekJwtClaims('not-a-jwt')).toBeNull();
    expect(peekJwtClaims('xxx.yyy')).toBeNull();
  });
});

describe('looksLikeSupabaseToken', () => {
  it('routes by iss=supabase.co host', () => {
    expect(
      looksLikeSupabaseToken({
        iss: 'https://abc.supabase.co/auth/v1',
        hasAppMetadata: false,
      })
    ).toBe(true);
  });

  it('routes by app_metadata presence when iss is non-borjie', () => {
    expect(
      looksLikeSupabaseToken({ iss: 'self-hosted-gotrue', hasAppMetadata: true })
    ).toBe(true);
  });

  it('returns false for gateway-issued tokens', () => {
    expect(
      looksLikeSupabaseToken({ iss: 'borjie', hasAppMetadata: false })
    ).toBe(false);
  });

  it('returns false for null input', () => {
    expect(looksLikeSupabaseToken(null)).toBe(false);
  });
});

describe('extractBearerToken', () => {
  it('extracts a token from a well-formed header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });
  it('returns null for missing/malformed', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Basic xyz')).toBeNull();
  });
});

describe('authMiddleware — gateway-issued JWT path', () => {
  it('accepts a valid gateway JWT and populates auth context', async () => {
    const app = makeAuthProbeApp();
    const token = mintGatewayToken({
      userId: 'gw-user-42',
      tenantId: 'gw-tenant-9',
      role: 'TENANT_ADMIN',
      email: 'admin@example.com',
    });

    const res = await app.request('/probe', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: AuthContext };
    expect(body.auth.userId).toBe('gw-user-42');
    expect(body.auth.tenantId).toBe('gw-tenant-9');
    expect(body.auth.role).toBe('TENANT_ADMIN');
    expect(body.auth.email).toBe('admin@example.com');
  });

  it('rejects a gateway JWT signed with the wrong secret as 401', async () => {
    const app = makeAuthProbeApp();
    const bad = jwt.sign(
      { userId: 'x', tenantId: 't', role: 'RESIDENT', permissions: [], propertyAccess: [] },
      'a-completely-different-secret',
      { issuer: 'borjie', audience: 'borjie-api', algorithm: 'HS256' }
    );
    const res = await app.request('/probe', {
      headers: { Authorization: `Bearer ${bad}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('authMiddleware — Supabase JWT path (audit F1)', () => {
  it('accepts a Supabase token with app_metadata.tenant_id and projects context', async () => {
    // CL-1 hardening: when `user_metadata.tenant_id` is PRESENT AND
    // DISAGREES with `app_metadata.tenant_id`, the request is rejected
    // as a self-promotion attempt (see packages/ai-copilot/src/config/
    // supabase-auth.ts:144-172). The happy-path test therefore omits
    // user_metadata.tenant_id entirely so we exercise the projection.
    const app = makeAuthProbeApp();
    const token = await mintSupabaseToken({
      sub: 'sb-user-100',
      email: 'asha@kilimani.com',
      app_metadata: {
        tenant_id: 'sb-tenant-77',
        roles: ['RESIDENT'],
      },
      user_metadata: {
        // No tenant_id here — F6's stricter contract rejects disagreement.
        display_name: 'Asha K.',
      },
    });

    const res = await app.request('/probe', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: AuthContext };
    expect(body.auth.userId).toBe('sb-user-100');
    // F6: tenant_id MUST be the app_metadata value.
    expect(body.auth.tenantId).toBe('sb-tenant-77');
    expect(body.auth.email).toBe('asha@kilimani.com');
    expect(body.auth.role).toBe('RESIDENT');
  });

  it('rejects a Supabase token whose tenant_id only lives in user_metadata (F6 protection)', async () => {
    const app = makeAuthProbeApp();
    // No app_metadata at all; tenant_id only in user_metadata.
    // The ai-copilot helper would accept this, but the gateway boundary
    // rejects it because user_metadata is client-modifiable.
    const token = await mintSupabaseToken({
      sub: 'sb-user-101',
      user_metadata: { tenant_id: 'forged-by-client' },
    });

    const res = await app.request('/probe', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_TOKEN');
    expect(body.error.message).toMatch(/app_metadata/i);
  });

  it('rejects a Supabase token with no tenant claim at all', async () => {
    const app = makeAuthProbeApp();
    const token = await mintSupabaseToken({
      sub: 'sb-user-102',
      // No metadata of any kind.
    });

    const res = await app.request('/probe', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a Supabase-shaped token signed with the wrong secret', async () => {
    const app = makeAuthProbeApp();
    const wrongSecret = new TextEncoder().encode('a-completely-different-secret');
    const token = await mintSupabaseToken(
      {
        sub: 'sb-user-103',
        app_metadata: { tenant_id: 't-x' },
      },
      { secret: wrongSecret }
    );

    const res = await app.request('/probe', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('authMiddleware — malformed and missing tokens', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const app = makeAuthProbeApp();
    const res = await app.request('/probe');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a completely malformed bearer token', async () => {
    const app = makeAuthProbeApp();
    const res = await app.request('/probe', {
      headers: { Authorization: 'Bearer not-even-a-jwt' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  it('returns 401 for a Bearer header with empty token', async () => {
    const app = makeAuthProbeApp();
    const res = await app.request('/probe', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
  });
});

describe('authMiddleware — audit log carries auth_path', () => {
  it('logs auth_path=supabase on successful Supabase-token resolution', async () => {
    const app = makeAuthProbeApp();
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const token = await mintSupabaseToken({
        sub: 'sb-audit-1',
        app_metadata: { tenant_id: 'sb-tenant-audit' },
      });
      const res = await app.request('/probe', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const calls = spy.mock.calls.map((c) => String(c[0]));
      const auditLine = calls.find((l) => l.includes('auth_principal_resolved'));
      expect(auditLine).toBeDefined();
      expect(auditLine).toContain('"auth_path":"supabase"');
      expect(auditLine).toContain('"outcome":"allow"');
    } finally {
      spy.mockRestore();
    }
  });

  it('logs auth_path=gateway on successful gateway-token resolution', async () => {
    const app = makeAuthProbeApp();
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const token = mintGatewayToken({ userId: 'gw-audit-1', tenantId: 'gw-tenant-audit' });
      const res = await app.request('/probe', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const calls = spy.mock.calls.map((c) => String(c[0]));
      const auditLine = calls.find((l) => l.includes('auth_principal_resolved'));
      expect(auditLine).toBeDefined();
      expect(auditLine).toContain('"auth_path":"gateway"');
    } finally {
      spy.mockRestore();
    }
  });

  it('logs outcome=reject on rejection so SOC sees which path failed', async () => {
    const app = makeAuthProbeApp();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const token = await mintSupabaseToken({
        sub: 'sb-rej-1',
        user_metadata: { tenant_id: 'client-forged' },
      });
      const res = await app.request('/probe', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(401);
      const calls = spy.mock.calls.map((c) => String(c[0]));
      const auditLine = calls.find((l) => l.includes('auth_principal_resolved'));
      expect(auditLine).toBeDefined();
      expect(auditLine).toContain('"outcome":"reject"');
      expect(auditLine).toContain('"auth_path":"supabase"');
    } finally {
      spy.mockRestore();
    }
  });
});
