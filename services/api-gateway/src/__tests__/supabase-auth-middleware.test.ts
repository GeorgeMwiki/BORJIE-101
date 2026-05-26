/**
 * Tests for the api-gateway Supabase Auth middleware.
 *
 * Uses jose's SignJWT to issue test tokens with a deterministic secret,
 * then exercises the middleware against a minimal Hono app. No live
 * Supabase project required.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

import {
  mapSupabaseRolesToUserRole,
  supabaseAuthMiddleware,
} from '../auth/supabase/supabase-auth-middleware.js';
import { UserRole } from '../types/user-role.js';

const SECRET = 'test-secret-do-not-use-in-production-but-long-enough';

async function makeToken(payload: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(SECRET);
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
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

describe('supabaseAuthMiddleware', () => {
  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
  });

  it('rejects when SUPABASE_JWT_SECRET is missing', async () => {
    delete process.env.SUPABASE_JWT_SECRET;
    const app = buildApp();
    const res = await app.request('http://x/me', {
      headers: { Authorization: 'Bearer anything' },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_PROVIDER_MISCONFIGURED');
  });

  it('rejects missing bearer with 401 UNAUTHORIZED', async () => {
    const app = buildApp();
    const res = await app.request('http://x/me');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid signature with 401 INVALID_TOKEN', async () => {
    const app = buildApp();
    // Issue token with a DIFFERENT secret so verify fails.
    const badToken = await new SignJWT({
      app_metadata: { tenant_id: 't1', roles: ['admin'] },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('wrong-secret-of-sufficient-length'));
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${badToken}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  it('rejects token without tenant claim with 403', async () => {
    const app = buildApp();
    const token = await makeToken({
      app_metadata: { roles: ['admin'] }, // no tenant_id
    });
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('accepts a valid token and populates auth context', async () => {
    const app = buildApp();
    const token = await makeToken({
      email: 'admin@example.com',
      app_metadata: {
        tenant_id: 'tenant-1',
        tenant_name: 'Acme',
        roles: ['admin'],
        environment: 'staging',
      },
    });
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      auth: {
        userId: string;
        tenantId: string;
        role: string;
        email: string;
      };
    };
    expect(body.auth.tenantId).toBe('tenant-1');
    expect(body.auth.userId).toBe('user-1');
    expect(body.auth.email).toBe('admin@example.com');
    expect(body.auth.role).toBe(UserRole.TENANT_ADMIN);
  });

  it('honors app_metadata for tenant assignment and ignores user_metadata tenant when it agrees', async () => {
    const app = buildApp();
    const token = await makeToken({
      user_metadata: { tenant_id: 'real-tenant' },
      app_metadata: { tenant_id: 'real-tenant', roles: ['resident'] },
    });
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { auth: { tenantId: string; role: string } };
    expect(body.auth.tenantId).toBe('real-tenant');
    expect(body.auth.role).toBe(UserRole.RESIDENT);
  });

  it('rejects a user_metadata.tenant_id self-promotion attempt (F6) with 403', async () => {
    const app = buildApp();
    const token = await makeToken({
      user_metadata: { tenant_id: 'evil-tenant', roles: ['super_admin'] },
      app_metadata: { tenant_id: 'real-tenant', roles: ['resident'] },
    });
    const res = await app.request('http://x/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

describe('mapSupabaseRolesToUserRole', () => {
  it('maps super_admin', () => {
    expect(mapSupabaseRolesToUserRole(['super_admin'])).toBe(UserRole.SUPER_ADMIN);
  });
  it('maps admin to TENANT_ADMIN', () => {
    expect(mapSupabaseRolesToUserRole(['admin'])).toBe(UserRole.TENANT_ADMIN);
  });
  it('maps owner', () => {
    expect(mapSupabaseRolesToUserRole(['owner'])).toBe(UserRole.OWNER);
  });
  it('maps resident', () => {
    expect(mapSupabaseRolesToUserRole(['resident'])).toBe(UserRole.RESIDENT);
  });
  it('picks highest-priority role when multiple are present', () => {
    expect(
      mapSupabaseRolesToUserRole(['resident', 'admin', 'maintenance']),
    ).toBe(UserRole.TENANT_ADMIN);
  });
  it('falls back to TENANT_ADMIN for unrecognized roles', () => {
    expect(mapSupabaseRolesToUserRole(['mystery_role'])).toBe(
      UserRole.TENANT_ADMIN,
    );
  });
});
