/**
 * Tests for /me/tenants — Roadmap R12.
 *
 * Drives the rail backend through a db.execute stub:
 *   - 401 without token
 *   - empty list when caller has zero links
 *   - hydrated list with `active` flag set by cookie + auth fallback
 *   - 403 TENANT_NOT_LINKED when switching to a tenant the user has
 *     no link for
 *   - cookie is set on successful switch with HttpOnly + SameSite=Lax
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { generateToken } from '../middleware/auth';
import { UserRole } from '../types/user-role';
import { meTenantsRouter } from '../routes/me-tenants.hono';

const TEST_USER = 'a0000000-0000-0000-0000-000000000001';
const TEST_TENANT_A = 'b0000000-0000-0000-0000-00000000000a';
const TEST_TENANT_B = 'b0000000-0000-0000-0000-00000000000b';
const TEST_TENANT_C = 'b0000000-0000-0000-0000-00000000000c';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: TEST_USER,
    tenantId: TEST_TENANT_A,
    role: UserRole.ADMIN as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

interface DbPlan {
  readonly memberships?: Array<Record<string, unknown>>;
  readonly switchCheck?: Array<Record<string, unknown>>;
}

function buildDb(plan: DbPlan): {
  execute: (q: unknown) => Promise<unknown>;
} {
  return {
    execute: async (q: unknown) => {
      const sqlText =
        typeof q === 'object' && q !== null && 'queryChunks' in q
          ? JSON.stringify((q as { queryChunks: unknown }).queryChunks)
          : JSON.stringify(q);
      if (
        sqlText.includes('person_links') &&
        sqlText.includes('tenant_name')
      ) {
        return plan.memberships ?? [];
      }
      if (sqlText.includes('SELECT 1') && sqlText.includes('person_links')) {
        return plan.switchCheck ?? [];
      }
      return [];
    },
  };
}

function attach(db: { execute: (q: unknown) => Promise<unknown> } | null) {
  return async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set('db', db);
    await next();
  };
}

function mount(db: { execute: (q: unknown) => Promise<unknown> } | null) {
  const app = new Hono();
  app.use('*', attach(db));
  app.route('/me/tenants', meTenantsRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
});

describe('GET /me/tenants', () => {
  it('rejects without token', async () => {
    const app = mount(null);
    const res = await app.request('/me/tenants');
    expect(res.status).toBe(401);
  });

  it('returns 503 when db is null', async () => {
    const app = mount(null);
    const res = await app.request('/me/tenants', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
  });

  it('returns empty list when caller has no memberships', async () => {
    const db = buildDb({ memberships: [] });
    const app = mount(db);
    const res = await app.request('/me/tenants', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('marks the auth-context tenant as active when no cookie set', async () => {
    const db = buildDb({
      memberships: [
        {
          tenant_id: TEST_TENANT_A,
          tenant_name: 'Mine A',
          logo_url: null,
          role_in_tenant: 'owner',
          linked_at: '2026-01-01T00:00:00.000Z',
        },
        {
          tenant_id: TEST_TENANT_B,
          tenant_name: 'Mine B',
          logo_url: null,
          role_in_tenant: 'manager',
          linked_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    const app = mount(db);
    const res = await app.request('/me/tenants', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ tenantId: string; active: boolean }>;
    };
    const a = body.data.find((m) => m.tenantId === TEST_TENANT_A);
    const b = body.data.find((m) => m.tenantId === TEST_TENANT_B);
    expect(a?.active).toBe(true);
    expect(b?.active).toBe(false);
  });

  it('honours the borjie-active-tenant cookie when present', async () => {
    const db = buildDb({
      memberships: [
        {
          tenant_id: TEST_TENANT_A,
          tenant_name: 'Mine A',
          logo_url: null,
          role_in_tenant: 'owner',
          linked_at: '2026-01-01T00:00:00.000Z',
        },
        {
          tenant_id: TEST_TENANT_B,
          tenant_name: 'Mine B',
          logo_url: null,
          role_in_tenant: 'manager',
          linked_at: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    const app = mount(db);
    const res = await app.request('/me/tenants', {
      headers: {
        Authorization: bearer(),
        Cookie: `borjie-active-tenant=${TEST_TENANT_B}`,
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ tenantId: string; active: boolean }>;
    };
    const a = body.data.find((m) => m.tenantId === TEST_TENANT_A);
    const b = body.data.find((m) => m.tenantId === TEST_TENANT_B);
    expect(a?.active).toBe(false);
    expect(b?.active).toBe(true);
  });
});

describe('POST /me/tenants/active', () => {
  it('rejects without token', async () => {
    const app = mount(null);
    const res = await app.request('/me/tenants/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: TEST_TENANT_B }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects invalid body via zod', async () => {
    const db = buildDb({});
    const app = mount(db);
    const res = await app.request('/me/tenants/active', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tenantId: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 TENANT_NOT_LINKED when user has no link', async () => {
    const db = buildDb({ switchCheck: [] });
    const app = mount(db);
    const res = await app.request('/me/tenants/active', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tenantId: TEST_TENANT_C }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TENANT_NOT_LINKED');
  });

  it('sets HttpOnly SameSite=Lax cookie on success', async () => {
    const db = buildDb({ switchCheck: [{ '?column?': 1 }] });
    const app = mount(db);
    const res = await app.request('/me/tenants/active', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tenantId: TEST_TENANT_B }),
    });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('borjie-active-tenant=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    const body = (await res.json()) as {
      data: { activeTenantId: string };
    };
    expect(body.data.activeTenantId).toBe(TEST_TENANT_B);
  });
});
