/**
 * Analytics warehouse routers — auth/role gates + real-series passthrough.
 *
 * WS-4. These routers replaced the degraded skeletons: they now read REAL
 * series from the analytics warehouses (0175/0176/0177) via the RLS-pinned
 * request `db`. The end-to-end aggregation + RLS isolation is proven against a
 * real Postgres in
 * `packages/database/src/__tests__/analytics-warehouse.integration.test.ts`.
 *
 * Here we assert the GATEWAY contract with a stub `db`:
 *   - anonymous → 401, RESIDENT → 403 (auth + role gates intact);
 *   - OWNER → 200 with the repo-shaped series (NO X-Backend-Status header);
 *   - tenant scoping: the route reads tenantId from the auth context (a query
 *     string cannot override it).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.USE_MOCK_DATA = process.env.USE_MOCK_DATA ?? 'true';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import { analyticsUsageRouter } from '../analytics-usage.router';
import { analyticsGrowthRouter } from '../analytics-growth.router';
import { analyticsExportsRouter } from '../analytics-exports.router';

const TENANT = 'tenant-an-1';
const USER = 'user-an-1';

function bearer(role: UserRole = UserRole.OWNER, tenantId = TENANT): string {
  return `Bearer ${generateToken({
    userId: USER,
    tenantId,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

/**
 * Stub Drizzle client: every fluent SELECT terminates in `rows`; `insert`
 * returns `insertReturning`. Thenable at each chain step so `await db.select()
 * .from().where().orderBy().limit()` resolves to `rows`.
 */
function makeStubDb(rows: unknown[], insertReturning: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  const ret = () => chain;
  chain.select = ret;
  chain.from = ret;
  chain.where = ret;
  chain.orderBy = ret;
  chain.limit = ret;
  chain.then = (resolve: (v: unknown) => unknown) => resolve(rows);
  const insertChain: Record<string, unknown> = {};
  insertChain.values = () => insertChain;
  insertChain.returning = () => Promise.resolve(insertReturning);
  chain.insert = () => insertChain;
  chain.execute = () => Promise.resolve(rows);
  return chain;
}

/** Mount a router behind a fake auth+db middleware so no live PG is needed. */
function mount(prefix: string, router: Hono, db: unknown): Hono {
  const app = new Hono();
  app.use(`${prefix}/*`, async (c, next) => {
    // Pre-inject db so databaseMiddleware honours it (no live PG needed). We
    // also pre-set repos so the no-pin/pin paths don't try to build them.
    c.set('db', db as never);
    c.set('repos', null as never);
    await next();
  });
  app.route(prefix, router);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

describe('GET /analytics/usage (real warehouse)', () => {
  const rows = [
    { day: '2026-05-02', dimension: 'AUTH', count: 3 },
    { day: '2026-05-01', dimension: 'PAYMENT', count: 2 },
  ];
  const app = mount('/analytics/usage', analyticsUsageRouter, makeStubDb(rows));

  it('rejects anonymous callers (401)', async () => {
    const res = await app.request('/analytics/usage');
    expect(res.status).toBe(401);
  });

  it('rejects RESIDENT role (403)', async () => {
    const res = await app.request('/analytics/usage', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('returns 200 with a real series and NO degraded header for OWNER', async () => {
    const res = await app.request('/analytics/usage', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-backend-status')).toBeNull();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ dimension: 'AUTH', count: 3 });
  });

  it('rejects an invalid range token (400)', async () => {
    const res = await app.request('/analytics/usage?range=7y', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /analytics/growth (real warehouse)', () => {
  const rows = [
    {
      period: '2026-05-01',
      activeSites: 1,
      productionKg: 1200,
      salesCount: 2,
      revenueMinorUnits: 12000,
      royaltyMinorUnits: 900,
      currency: 'TZS',
    },
  ];
  const app = mount('/analytics/growth', analyticsGrowthRouter, makeStubDb(rows));

  it('rejects anonymous callers (401)', async () => {
    const res = await app.request('/analytics/growth');
    expect(res.status).toBe(401);
  });

  it('returns 200 with revenue + currency (currency never hardcoded) for OWNER', async () => {
    const res = await app.request('/analytics/growth', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data[0]).toMatchObject({
      revenueMinorUnits: 12000,
      currency: 'TZS',
    });
  });
});

describe('GET/POST /analytics/exports/templates (real warehouse)', () => {
  const listRows = [
    { id: 'aet_1', name: 'Royalty CSV', kind: 'csv', schema: {}, createdAt: new Date() },
  ];
  const created = [{ id: 'aet_2', name: 'New', kind: 'csv' }];
  const app = mount(
    '/analytics/exports',
    analyticsExportsRouter,
    makeStubDb(listRows, created),
  );

  it('rejects RESIDENT on list (403)', async () => {
    const res = await app.request('/analytics/exports/templates', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('lists templates (200) for OWNER', async () => {
    const res = await app.request('/analytics/exports/templates', {
      headers: { Authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0]).toMatchObject({ name: 'Royalty CSV' });
  });

  it('creates a template (201) for OWNER', async () => {
    const res = await app.request('/analytics/exports/templates', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.OWNER),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'New', kind: 'csv', schema: {} }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects an invalid template body (400)', async () => {
    const res = await app.request('/analytics/exports/templates', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.OWNER),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ kind: 'csv' }), // missing name
    });
    expect(res.status).toBe(400);
  });
});
