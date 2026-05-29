/**
 * Owner-portal BFF tests — covers the C-agent gap-fix endpoints:
 *
 *   GET  /budgets/summary             (honest-empty)
 *   GET  /budgets/forecasts           (honest-empty)
 *   GET  /compliance/inspections      (real-wrap → inspections table)
 *   GET  /compliance/insurance        (honest-empty)
 *   GET  /compliance/licenses         (honest-empty)
 *   GET  /compliance/summary          (real inspections count, others 0)
 *   GET  /tenants/communications      (real-wrap → messaging digest)
 *   POST /invitations/co-owner        (stub with HMAC-signed token)
 *   GET  /invitations                 (honest-empty)
 *   POST /invitations/:id/cancel      (stub, returns 200 with id+status)
 *
 * Auth gating is asserted against the JWT-mounted real router. The
 * router's role gate rejects RESIDENT, so all happy-path tests use a
 * synthetic OWNER bearer token.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// JWT secret + NODE_ENV must be set BEFORE importing the router (auth
// middleware captures the secret at module init; database middleware
// short-circuits to 503 outside test mode).
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.USE_MOCK_DATA = process.env.USE_MOCK_DATA ?? 'true';

import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import { ownerPortalRouter } from '../owner-portal';

const TEST_TENANT = 'tenant-1';
const TEST_USER = 'user-owner-1';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: TEST_USER,
    tenantId: TEST_TENANT,
    role: UserRole.OWNER as any,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

/**
 * Build a fresh Hono app with the owner-portal router mounted, and
 * pre-populate the request context with whatever fakes the test needs.
 *
 * `repos` and `db` set BEFORE the router run are honoured by the
 * databaseMiddleware (it sees a pre-populated value and skips the live
 * client init).
 */
function mountWithContext(
  overrides: { repos?: unknown; db?: unknown; services?: unknown } = {},
): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (overrides.repos !== undefined) c.set('repos', overrides.repos);
    if (overrides.db !== undefined) c.set('db', overrides.db);
    if (overrides.services !== undefined) c.set('services', overrides.services);
    await next();
  });
  app.route('/owner', ownerPortalRouter);
  return app;
}

/**
 * Stub repos that return an empty owner scope — every list is empty,
 * which is enough for endpoints that just need `getOwnerScope` to
 * resolve without throwing.
 */
function emptyRepos() {
  const empty = { items: [], total: 0 };
  // After the BFF aggregation refactor, getOwnerScope calls
  // `findByPropertyIds` on units / leases / customers / invoices /
  // payments instead of `findMany + JS .filter`. The stub keeps both
  // shapes so older tests that still poke `findMany` directly continue
  // to pass.
  return {
    properties: { findMany: async () => empty },
    units: { findMany: async () => empty, findByPropertyIds: async () => empty },
    leases: { findMany: async () => empty, findByPropertyIds: async () => empty },
    customers: { findMany: async () => empty, findByPropertyIds: async () => empty },
    invoices: {
      findMany: async () => empty,
      findByPropertyIds: async () => ({ ...empty, limit: 1000, offset: 0, hasMore: false }),
      sumBalanceByCustomer: async () => 0,
    },
    payments: {
      findMany: async () => empty,
      findByPropertyIds: async () => ({ ...empty, limit: 1000, offset: 0, hasMore: false }),
    },
    workOrders: {
      findMany: async () => empty,
      // Issue #43 closed: owner-scope now uses findBySiteIds.
      findBySiteIds: async () => [],
    },
    vendors: { findByIds: async () => [] },
    documents: { findMany: async () => empty },
    users: { findById: async () => null },
    messaging: {
      getMessages: async () => [],
      getConversation: async () => null,
      createMessage: async () => ({}),
    },
  };
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

// ---------------------------------------------------------------------------
// 1. GET /owner/budgets/summary — honest-empty
// ---------------------------------------------------------------------------

describe('GET /owner/budgets/summary', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/owner/budgets/summary');
    expect(res.status).toBe(401);
  });

  it('returns honest-empty rollup with USD + budgets-not-wired note', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: { execute: async () => undefined } });
    const res = await app.request('/owner/budgets/summary', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      totalBudgetMajor: 0,
      spentMajor: 0,
      varianceMajor: 0,
      currency: 'USD',
      meta: { note: expect.stringMatching(/budgets/) },
    });
  });
});

// ---------------------------------------------------------------------------
// 2. GET /owner/budgets/forecasts — honest-empty
// ---------------------------------------------------------------------------

describe('GET /owner/budgets/forecasts', () => {
  it('returns honest-empty forecasts list', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: { execute: async () => undefined } });
    const res = await app.request('/owner/budgets/forecasts', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.forecasts).toEqual([]);
    expect(body.data.meta?.note).toMatch(/budgets/);
  });
});

// ---------------------------------------------------------------------------
// 3. GET /owner/compliance/inspections — real-wrap, filtered by ownership
// ---------------------------------------------------------------------------

describe('GET /owner/compliance/inspections', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/owner/compliance/inspections');
    expect(res.status).toBe(401);
  });

  it('queries inspections filtered by owner property scope and returns rows', async () => {
    let whereCalls = 0;
    const repos = emptyRepos();
    repos.properties.findMany = async () => ({
      items: [{ id: 'prop-1' }, { id: 'prop-2' }],
      total: 2,
    });
    // Drizzle chain stub: db.select().from(...).where(...).orderBy(...).limit(...)
    const db = {
      execute: async () => undefined,
      select: () => ({
        from: () => ({
          where: () => {
            whereCalls += 1;
            return {
              orderBy: () => ({
                limit: async () => [
                  {
                    id: 'insp-1',
                    tenantId: TEST_TENANT,
                    propertyId: 'prop-1',
                    status: 'scheduled',
                  },
                ],
              }),
            };
          },
        }),
      }),
    };
    const app = mountWithContext({ repos, db });

    const res = await app.request('/owner/compliance/inspections', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('insp-1');
    expect(whereCalls).toBe(1);
  });

  it('returns honest-empty data with note when db is unavailable', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: null });
    const res = await app.request('/owner/compliance/inspections', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta?.note).toBeDefined();
  });

  it('skips the query when the owner has no properties', async () => {
    let whereCalls = 0;
    const db = {
      execute: async () => undefined,
      select: () => ({
        from: () => ({
          where: () => {
            whereCalls += 1;
            return { orderBy: () => ({ limit: async () => [] }) };
          },
        }),
      }),
    };
    const app = mountWithContext({ repos: emptyRepos(), db });
    const res = await app.request('/owner/compliance/inspections', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(whereCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. GET /owner/compliance/insurance — honest-empty
// ---------------------------------------------------------------------------

describe('GET /owner/compliance/insurance', () => {
  it('returns honest-empty list with insurance-not-wired note', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: { execute: async () => undefined } });
    const res = await app.request('/owner/compliance/insurance', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: [],
      meta: { note: expect.stringMatching(/insurance/) },
    });
  });
});

// ---------------------------------------------------------------------------
// 5. GET /owner/compliance/licenses — honest-empty
// ---------------------------------------------------------------------------

describe('GET /owner/compliance/licenses', () => {
  it('returns honest-empty list with licenses-not-wired note', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: { execute: async () => undefined } });
    const res = await app.request('/owner/compliance/licenses', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: [],
      meta: { note: expect.stringMatching(/licenses/) },
    });
  });
});

// ---------------------------------------------------------------------------
// 6. GET /owner/compliance/summary
// ---------------------------------------------------------------------------

describe('GET /owner/compliance/summary', () => {
  it('returns 0/0/0 with note when no properties / no db', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: null });
    const res = await app.request('/owner/compliance/summary', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.inspectionsDueCount).toBe(0);
    expect(body.data.insuranceExpiringCount).toBe(0);
    expect(body.data.licensesExpiringCount).toBe(0);
    expect(body.data.meta?.note).toBeDefined();
  });

  it('counts non-closed inspections as "due"', async () => {
    const repos = emptyRepos();
    repos.properties.findMany = async () => ({
      items: [{ id: 'prop-1' }],
      total: 1,
    });
    const db = {
      execute: async () => undefined,
      select: () => ({
        from: () => ({
          where: async () => [
            { id: 'i1', status: 'scheduled' },
            { id: 'i2', status: 'in_progress' },
            { id: 'i3', status: 'completed' },
            { id: 'i4', status: 'archived' },
          ],
        }),
      }),
    };
    const app = mountWithContext({ repos, db });
    const res = await app.request('/owner/compliance/summary', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // scheduled + in_progress = 2 due; completed + archived excluded.
    expect(body.data.inspectionsDueCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. GET /owner/tenants/communications — wraps messaging digest
// ---------------------------------------------------------------------------

describe('GET /owner/tenants/communications', () => {
  it('returns honest-empty list when repos/db unavailable', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: null });
    const res = await app.request('/owner/tenants/communications', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta?.note).toMatch(/communications/);
  });

  it('reshapes messaging conversations into a flat communications list', async () => {
    // Build a fully-linked owner scope so getOwnerScope keeps the customer
    // in-scope (customer → lease → property must all be present). After
    // the BFF aggregation refactor, getOwnerScope calls findByPropertyIds
    // on units / leases / customers / invoices / payments — we populate
    // BOTH legacy `findMany` and the new `findByPropertyIds` so this
    // test exercises the new code path cleanly.
    const repos = emptyRepos();
    repos.properties.findMany = async () => ({
      items: [{ id: 'prop-1', name: 'Sunrise' }],
      total: 1,
    });
    const unitsRows = {
      items: [{ id: 'unit-1', propertyId: 'prop-1', unitCode: 'U1' }],
      total: 1,
    };
    repos.units.findMany = async () => unitsRows;
    repos.units.findByPropertyIds = async () => unitsRows;
    const leasesRows = {
      items: [
        {
          id: 'lease-1',
          propertyId: 'prop-1',
          unitId: 'unit-1',
          customerId: 'cust-1',
        },
      ],
      total: 1,
    };
    repos.leases.findMany = async () => leasesRows;
    repos.leases.findByPropertyIds = async () => leasesRows;
    const customersRows = {
      items: [
        { id: 'cust-1', firstName: 'Alice', lastName: 'Resident' },
      ],
      total: 1,
    };
    repos.customers.findMany = async () => customersRows;
    repos.customers.findByPropertyIds = async () => customersRows;
    repos.messaging.getMessages = async () => [
      {
        id: 'msg-1',
        content: 'Rent question',
        createdAt: '2026-04-01T12:00:00Z',
      },
    ];
    const db = {
      execute: async () => undefined,
      select: () => ({
        from: () => ({
          where: async () => [
            {
              id: 'conv-1',
              tenantId: TEST_TENANT,
              customerId: 'cust-1',
              type: 'maintenance',
              createdAt: '2026-04-01T11:00:00Z',
              updatedAt: '2026-04-01T12:00:00Z',
              lastMessageAt: '2026-04-01T12:00:00Z',
              metadata: { propertyName: 'Sunrise Apartments' },
            },
          ],
        }),
      }),
    };
    const app = mountWithContext({ repos, db });
    const res = await app.request('/owner/tenants/communications', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('conv-1');
    expect(body.data[0].tenantName).toBe('Alice Resident');
    expect(body.data[0].lastMessage).toBe('Rent question');
    expect(body.data[0].property).toBe('Sunrise Apartments');
  });
});

// ---------------------------------------------------------------------------
// 8. POST /owner/invitations/co-owner — signed-token stub
// ---------------------------------------------------------------------------

describe('POST /owner/invitations/co-owner', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/owner/invitations/co-owner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'co@example.com', role: 'co-owner' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects malformed bodies (400)', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: { execute: async () => undefined } });
    const res = await app.request('/owner/invitations/co-owner', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'not-an-email', role: 'co-owner' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 501 loud-failure when no InvitationService and flag is off', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: { execute: async () => undefined } });
    const res = await app.request('/owner/invitations/co-owner', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'co@example.com',
        role: 'co-owner',
        propertyAccess: ['prop-1', 'prop-2'],
      }),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
    // Post-refactor: structured extras live under `error.details` per
    // the canonical errorResponse envelope (see utils/error-response.ts).
    // The field is named `featureFlag` so the redactDetails scrubber
    // (which strips /key/i) does NOT eat the value.
    expect(body.error.details?.featureFlag).toBe('flag.bff.owner_portal.invitations_create');
  });

  it('returns the signed token + invitationId when the dev-flag is on', async () => {
    const services = {
      featureFlags: {
        async isEnabled(_t: string, k: string) {
          return k === 'flag.bff.owner_portal.invitations_create';
        },
      },
    };
    const app = mountWithContext({
      repos: emptyRepos(),
      db: { execute: async () => undefined },
      services,
    });
    const res = await app.request('/owner/invitations/co-owner', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'co@example.com',
        role: 'co-owner',
        propertyAccess: ['prop-1', 'prop-2'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.invitationId).toBe('string');
    expect(body.data.invitationId.length).toBeGreaterThan(10);
    expect(typeof body.data.expiresAt).toBe('string');
    expect(new Date(body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // Token format: base64url(payload).base64url(hmac-sha256)
    expect(body.data.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(body.data.meta?.note).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 9. GET /owner/invitations — honest-empty
// ---------------------------------------------------------------------------

describe('GET /owner/invitations', () => {
  it('returns honest-empty list with invitation-pipeline-not-wired note', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: { execute: async () => undefined } });
    const res = await app.request('/owner/invitations', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: [],
      meta: { note: expect.stringMatching(/invitation/i) },
    });
  });
});

// ---------------------------------------------------------------------------
// 10. POST /owner/invitations/:id/cancel
// ---------------------------------------------------------------------------

describe('POST /owner/invitations/:id/cancel', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/owner/invitations/abc/cancel', {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 with id + cancelled status', async () => {
    const app = mountWithContext({ repos: emptyRepos(), db: { execute: async () => undefined } });
    const res = await app.request('/owner/invitations/inv-99/cancel', {
      method: 'POST',
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('inv-99');
    expect(body.data.status).toBe('cancelled');
  });
});
