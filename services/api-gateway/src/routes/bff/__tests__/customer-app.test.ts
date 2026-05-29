/**
 * Customer-app BFF aggregator tests.
 *
 * Post Borjie hard-fork: /letters, /sublease (POST+GET),
 * /move-out/disputes, /marketplace/:unitId/negotiate(s) have been
 * deleted (see customer-app.ts header). The remaining surface:
 *
 *   GET  /me, /me/dashboard, /maintenance, /utilities, /community
 *
 * Property-domain repos (workOrders, leases, invoices, payments) were
 * removed from the @borjie/database barrel during the fork, so the
 * remaining handlers return shape-correct empty envelopes instead of
 * crashing.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// JWT secret + NODE_ENV must be pinned BEFORE importing the router (the
// auth middleware captures the secret at module init, and database
// middleware short-circuits to 503 outside test mode).
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.USE_MOCK_DATA = process.env.USE_MOCK_DATA ?? 'true';

import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import { customerAppRouter } from '../customer-app';

const TEST_TENANT = 'tenant-1';
const TEST_USER = 'user-resident-1';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: TEST_USER,
    tenantId: TEST_TENANT,
    role: UserRole.RESIDENT as any,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

/**
 * Build a fresh Hono app with the customer-app router mounted, and
 * pre-populate the request context with whatever fakes the test needs.
 *
 * IMPORTANT: the router itself runs `authMiddleware` then
 * `databaseMiddleware` as `app.use('*', ...)`. Anything we set on the
 * request context BEFORE the router runs is preserved by both middlewares.
 */
function mountWithContext(overrides: {
  repos?: unknown;
  db?: unknown;
  services?: unknown;
} = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (overrides.repos !== undefined) c.set('repos', overrides.repos);
    if (overrides.db !== undefined) c.set('db', overrides.db);
    if (overrides.services !== undefined) c.set('services', overrides.services);
    await next();
  });
  app.route('/customer', customerAppRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

// ---------------------------------------------------------------------------
// 1. /maintenance — post-fork honest empty (property-domain workOrders
//    repo was deleted; mining task list now lives at /api/v1/mining/tasks).
// ---------------------------------------------------------------------------

describe('GET /customer/maintenance', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/maintenance');
    expect(res.status).toBe(401);
  });

  it('returns honest empty array when repos are wired (post-hard-fork stub)', async () => {
    const app = mountWithContext({ repos: { tenants: {}, users: {} } });
    const res = await app.request('/customer/maintenance', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('returns 503 when repos are unavailable', async () => {
    const app = mountWithContext({ repos: null });
    const res = await app.request('/customer/maintenance', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// REMOVED (borjie hard-fork): test suites for /letters, /sublease (POST+GET),
// /move-out/disputes, /marketplace/:unitId/negotiate(s) — those routes were
// deleted from customer-app.ts (see file header). Buyer-side mineral
// haggling now lives at /api/v1/mining/marketplace + /api/v1/mining/bids
// and is covered by separate test suites in routes/mining/__tests__.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. Honest empty stubs — utilities + community
// ---------------------------------------------------------------------------

describe('GET /customer/utilities', () => {
  it('returns the honest empty utilities envelope', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/utilities', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        readings: [],
        bills: [],
        note: 'utilities-service not yet wired',
      },
    });
  });

  it('still requires auth (401 without bearer)', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/utilities');
    expect(res.status).toBe(401);
  });
});

describe('GET /customer/community', () => {
  it('returns the honest empty community envelope', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/community', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        posts: [],
        note: 'community-service not yet wired',
      },
    });
  });
});

// ---------------------------------------------------------------------------
// /me/dashboard — post-fork honest empty.
//
// Pre-fork (BossNyumba): pulled leases / invoices / payments per customer.
// Post-fork: those repos no longer exist; route returns shape-correct
// nulls + empty arrays. Customer dashboards now compose from owner-brief
// + mining endpoints (see /api/v1/owner/brief).
// ---------------------------------------------------------------------------

describe('GET /customer/me/dashboard (post-fork honest empty)', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/me/dashboard');
    expect(res.status).toBe(401);
  });

  it('returns shape-correct empty envelope when repos are wired', async () => {
    const app = mountWithContext({ repos: { tenants: {}, users: {} } });
    const res = await app.request('/customer/me/dashboard', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      activeLease: null,
      openBalance: 0,
      recentInvoices: [],
      recentPayments: [],
    });
  });

  it('returns 503 when repos are unavailable', async () => {
    const app = mountWithContext({ repos: null });
    const res = await app.request('/customer/me/dashboard', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
  });
});
