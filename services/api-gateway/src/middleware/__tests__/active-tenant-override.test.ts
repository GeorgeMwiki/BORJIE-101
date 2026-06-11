/**
 * SC-2 — the validated active-tenant override in the auth middleware.
 *
 * The dark synapse this closes: `/me/tenants/active` wrote the
 * `borjie-active-tenant` cookie that nothing read, so the RLS GUC always
 * bound to the JWT's home tenant. Now the auth middleware re-validates the
 * requested tenant against the MEMBERSHIP GRAPH per request:
 *   - absent / equal to the JWT tenant → no-op;
 *   - ACTIVE employment-class membership → tenantId AND userId rebound
 *     (the shadow user in the target tenant);
 *   - anything else → 403 TENANT_SWITCH_INVALID + self-healing cookie clear
 *     (fail-closed — a silent fallback would mis-scope writes);
 *   - the grant query structurally excludes buyers (user_id IS NOT NULL) and
 *     non-ACTIVE memberships — asserted on the SQL text;
 *   - grants are TTL-cached (one query, then cache hits).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { generateToken } from '../auth';
import { UserRole } from '../../types/user-role';
import { authMiddleware } from '../hono-auth';
import {
  ACTIVE_TENANT_HEADER_NAME,
  clearActiveTenantCache,
} from '../active-tenant-override';

const TEST_USER = 'a0000000-0000-0000-0000-000000000001';
const HOME_TENANT = 'b0000000-0000-0000-0000-00000000000a';
const OTHER_TENANT = 'b0000000-0000-0000-0000-00000000000b';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: TEST_USER,
    tenantId: HOME_TENANT,
    role: UserRole.ADMIN as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

/** Probe app: db pre-injected, echoes the post-auth context. */
function mount(grantRows: Array<Record<string, unknown>>, capture?: string[]) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', {
      execute: async (q: unknown) => {
        const sqlText =
          typeof q === 'object' && q !== null && 'queryChunks' in q
            ? JSON.stringify((q as { queryChunks: unknown }).queryChunks)
            : JSON.stringify(q);
        capture?.push(sqlText);
        if (sqlText.includes('shadow_user_id')) return grantRows;
        return [];
      },
    } as never);
    await next();
  });
  app.use('*', authMiddleware);
  app.get('/probe', (c) => {
    const auth = c.get('auth');
    return c.json({ tenantId: auth.tenantId, userId: auth.userId });
  });
  return app;
}

beforeEach(() => {
  clearActiveTenantCache();
});

describe('active-tenant override (SC-2)', () => {
  it('no header/cookie → JWT tenant flows through untouched', async () => {
    const app = mount([]);
    const res = await app.request('/probe', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantId: string; userId: string };
    expect(body.tenantId).toBe(HOME_TENANT);
    expect(body.userId).toBe(TEST_USER);
  });

  it('requested tenant equal to the JWT tenant is a no-op (no query)', async () => {
    const captured: string[] = [];
    const app = mount([], captured);
    const res = await app.request('/probe', {
      headers: {
        Authorization: bearer(),
        [ACTIVE_TENANT_HEADER_NAME]: HOME_TENANT,
      },
    });
    expect(res.status).toBe(200);
    expect(captured.filter((s) => s.includes('shadow_user_id'))).toHaveLength(0);
  });

  it('a membership grant rebinds BOTH tenantId and the shadow userId', async () => {
    const app = mount([
      { tenant_id: OTHER_TENANT, shadow_user_id: 'usr_shadow_other' },
    ]);
    const res = await app.request('/probe', {
      headers: {
        Authorization: bearer(),
        [ACTIVE_TENANT_HEADER_NAME]: OTHER_TENANT,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantId: string; userId: string };
    expect(body.tenantId).toBe(OTHER_TENANT);
    expect(body.userId).toBe('usr_shadow_other');
  });

  it('cookie carries the switch for web clients', async () => {
    const app = mount([
      { tenant_id: OTHER_TENANT, shadow_user_id: 'usr_shadow_other' },
    ]);
    const res = await app.request('/probe', {
      headers: {
        Authorization: bearer(),
        Cookie: `borjie-active-tenant=${OTHER_TENANT}`,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantId: string };
    expect(body.tenantId).toBe(OTHER_TENANT);
  });

  it('no membership → 403 TENANT_SWITCH_INVALID + cookie clear (fail-closed)', async () => {
    const app = mount([]);
    const res = await app.request('/probe', {
      headers: {
        Authorization: bearer(),
        [ACTIVE_TENANT_HEADER_NAME]: OTHER_TENANT,
      },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TENANT_SWITCH_INVALID');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('borjie-active-tenant=;');
    expect(cookie).toContain('Max-Age=0');
  });

  it('the grant SQL structurally excludes buyers and non-ACTIVE rows', async () => {
    const captured: string[] = [];
    const app = mount(
      [{ tenant_id: OTHER_TENANT, shadow_user_id: 'usr_x' }],
      captured,
    );
    await app.request('/probe', {
      headers: {
        Authorization: bearer(),
        [ACTIVE_TENANT_HEADER_NAME]: OTHER_TENANT,
      },
    });
    const grantSql = captured.find((s) => s.includes('shadow_user_id')) ?? '';
    expect(grantSql).toContain('user_id IS NOT NULL'); // buyers excluded
    expect(grantSql).toContain("status = 'ACTIVE'"); // ended memberships excluded
    expect(grantSql).toContain('identity_auth_principals'); // principal-resolved
  });

  it('grants are TTL-cached: the second request issues no second query', async () => {
    const captured: string[] = [];
    const app = mount(
      [{ tenant_id: OTHER_TENANT, shadow_user_id: 'usr_x' }],
      captured,
    );
    const headers = {
      Authorization: bearer(),
      [ACTIVE_TENANT_HEADER_NAME]: OTHER_TENANT,
    };
    await app.request('/probe', { headers });
    await app.request('/probe', { headers });
    expect(
      captured.filter((s) => s.includes('shadow_user_id')),
    ).toHaveLength(1);
  });
});
