/**
 * Customer-app BFF aggregator tests.
 *
 * Covers the seven new caller-scoped wraps + two honest empty stubs:
 *
 *   GET  /maintenance, /letters, /sublease, /move-out/disputes,
 *        /marketplace/:unitId/negotiations,
 *        /utilities, /community
 *   POST /sublease, /marketplace/:unitId/negotiate
 *
 * The strategy is structural:
 *  - mount the real router behind a stub middleware that pre-populates
 *    `auth`, `db`, `repos`, and `services` so we never touch Postgres,
 *  - assert the response envelope shape and the upstream call shape
 *    (e.g. `findByCustomer(userId, tenantId, ...)`).
 *
 * Auth gating is also asserted against the JWT-mounted real router so we
 * know the middleware ordering is correct.
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
// 1. /maintenance
// ---------------------------------------------------------------------------

describe('GET /customer/maintenance', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/maintenance');
    expect(res.status).toBe(401);
  });

  it('returns the caller-scoped work order list via repos.workOrders.findByCustomer', async () => {
    let receivedArgs: unknown[] = [];
    const repos = {
      workOrders: {
        findByCustomer: async (...args: unknown[]) => {
          receivedArgs = args;
          return {
            items: [
              {
                id: 'wo-1',
                tenantId: TEST_TENANT,
                customerId: TEST_USER,
                workOrderNumber: 'WO-001',
                title: 'Leaky tap',
                description: 'Kitchen tap drips',
                status: 'submitted',
                priority: 'low',
                category: 'plumbing',
              },
            ],
            total: 1,
          };
        },
      },
    };
    const app = mountWithContext({ repos });

    const res = await app.request('/customer/maintenance', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    // wraps the work-orders repo, scoped to the caller. The auth context
    // does not currently carry a customerId field, so the BFF falls back
    // to userId — both lookups go through the same column.
    expect(receivedArgs[0]).toBe(TEST_USER);
    expect(receivedArgs[1]).toBe(TEST_TENANT);
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
// 2. /letters
// ---------------------------------------------------------------------------

describe('GET /customer/letters', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/letters');
    expect(res.status).toBe(401);
  });

  it('queries letterRequests with tenant + requestedBy filter and returns rows', async () => {
    const calls: unknown[] = [];
    // Fake drizzle chain: db.select().from(table).where(cond) → rows.
    // `execute` is needed because databaseMiddleware sets RLS context
    // via `database.execute(SELECT set_config(...))` before any handler.
    const db = {
      execute: async () => undefined,
      select: () => ({
        from: (_table: unknown) => ({
          where: async (cond: unknown) => {
            calls.push(cond);
            return [
              {
                id: 'lr-1',
                tenantId: TEST_TENANT,
                requestedBy: TEST_USER,
                letterType: 'residency_proof',
                status: 'requested',
              },
            ];
          },
        }),
      }),
    };
    const app = mountWithContext({ db });

    const res = await app.request('/customer/letters', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].requestedBy).toBe(TEST_USER);
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3 + 4. Sublease — POST + GET
// ---------------------------------------------------------------------------

describe('POST /customer/sublease', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/sublease', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentLeaseId: 'lease-1' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 503 when sublease service is not wired', async () => {
    const app = mountWithContext({ services: {} });
    const res = await app.request('/customer/sublease', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parentLeaseId: 'lease-1' }),
    });
    expect(res.status).toBe(503);
  });

  it('injects auth.userId as requestedBy and returns 201 with the new id', async () => {
    let captured: { tenantId?: string; input?: any; actor?: string } = {};
    const services = {
      subleaseService: {
        submit: async (tenantId: string, input: any, actor: string) => {
          captured = { tenantId, input, actor };
          return { success: true, data: { id: 'sub-req-1' } };
        },
      },
    };
    const app = mountWithContext({ services });

    const res = await app.request('/customer/sublease', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        parentLeaseId: 'lease-1',
        reason: 'Travelling for work',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { id: 'sub-req-1' } });
    expect(captured.tenantId).toBe(TEST_TENANT);
    expect(captured.actor).toBe(TEST_USER);
    // BFF MUST inject requestedBy from auth — clients cannot spoof it.
    expect(captured.input?.requestedBy).toBe(TEST_USER);
    expect(captured.input?.parentLeaseId).toBe('lease-1');
  });
});

describe('GET /customer/sublease', () => {
  it('returns honest empty list when sublease repo is not wired', async () => {
    const app = mountWithContext({ services: {} });
    const res = await app.request('/customer/sublease', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta?.note).toMatch(/sublease/);
  });

  it('filters listPending rows by caller userId', async () => {
    const services = {
      sublease: {
        repo: {
          listPending: async (_tenantId: string) => [
            { id: 'r1', requestedBy: TEST_USER, status: 'pending' },
            { id: 'r2', requestedBy: 'someone-else', status: 'pending' },
          ],
        },
      },
    };
    const app = mountWithContext({ services });
    const res = await app.request('/customer/sublease', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((r: any) => r.id)).toEqual(['r1']);
  });
});

// ---------------------------------------------------------------------------
// 5. /move-out/disputes — honest empty (no per-tenant filter upstream)
// ---------------------------------------------------------------------------

describe('GET /customer/move-out/disputes', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/move-out/disputes');
    expect(res.status).toBe(401);
  });

  it('returns an honest empty list with a "not yet wired" note when damage repo is unwired', async () => {
    const app = mountWithContext({ services: {} });
    const res = await app.request('/customer/move-out/disputes', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: [],
      meta: { note: expect.stringMatching(/damage-deductions/) },
    });
  });

  it('returns 501 loud-failure when repo is wired but per-tenant filter is not (and no flag)', async () => {
    const services = {
      damageDeductions: {
        repo: {
          listOpen: async () => [
            { id: 'dd-1', leaseId: 'lease-x', status: 'claim_filed' },
          ],
        },
      },
      // No featureFlags service → flag default off → 501.
    };
    const app = mountWithContext({ services });
    const res = await app.request('/customer/move-out/disputes', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
    expect(body.error.flagKey).toBe('flag.bff.customer_app.move_out_disputes');
  });

  it('returns intersected list when repos.leases.findByCustomer is wired', async () => {
    const services = {
      damageDeductions: {
        repo: {
          listOpen: async () => [
            { id: 'dd-1', leaseId: 'lease-x', status: 'claim_filed' },
            { id: 'dd-2', leaseId: 'lease-y', status: 'pending' },
          ],
        },
      },
    };
    const repos = {
      leases: {
        async findByCustomer() {
          return [{ id: 'lease-x' }];
        },
      },
    };
    const app = mountWithContext({ services, repos });
    const res = await app.request('/customer/move-out/disputes', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('dd-1');
  });
});

// ---------------------------------------------------------------------------
// 6 + 7. /marketplace/:unitId/negotiate (POST) + negotiations (GET)
// ---------------------------------------------------------------------------

describe('POST /customer/marketplace/:unitId/negotiate', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/marketplace/unit-1/negotiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policyId: 'pol-1', openingOffer: 100 }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 503 when negotiation service is not wired', async () => {
    const app = mountWithContext({ services: {} });
    const res = await app.request('/customer/marketplace/unit-1/negotiate', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ policyId: 'pol-1', openingOffer: 100 }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('injects unitId from path + prospectCustomerId from auth, returns 201', async () => {
    let captured: { tenantId?: string; input?: any; actor?: string } = {};
    const services = {
      negotiation: {
        startNegotiation: async (
          tenantId: string,
          input: any,
          _correlationId: string,
          actor: string,
        ) => {
          captured = { tenantId, input, actor };
          return {
            ok: true,
            value: { negotiationId: 'neg-1', status: 'open' },
          };
        },
      },
    };
    const app = mountWithContext({ services });
    const res = await app.request(
      '/customer/marketplace/unit-42/negotiate',
      {
        method: 'POST',
        headers: {
          Authorization: bearer(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          policyId: 'pol-99',
          openingOffer: 12000,
          openingRationale: 'Twelve months upfront',
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.negotiationId).toBe('neg-1');
    expect(captured.tenantId).toBe(TEST_TENANT);
    expect(captured.actor).toBe(TEST_USER);
    expect(captured.input?.unitId).toBe('unit-42');
    // Auth context has no customerId field today, so prospectCustomerId
    // falls back to userId. When customerId starts being attached to the
    // JWT this assertion should become `TEST_CUSTOMER`.
    expect(captured.input?.prospectCustomerId).toBe(TEST_USER);
    expect(captured.input?.policyId).toBe('pol-99');
    expect(captured.input?.domain).toBe('lease_price');
  });

  it('rejects malformed bodies via zValidator (400)', async () => {
    const services = {
      negotiation: { startNegotiation: async () => ({ ok: true, value: {} }) },
    };
    const app = mountWithContext({ services });
    const res = await app.request('/customer/marketplace/unit-1/negotiate', {
      method: 'POST',
      headers: {
        Authorization: bearer(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ openingOffer: -1 }), // missing policyId, negative offer
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /customer/marketplace/:unitId/negotiations', () => {
  it('queries negotiations scoped to tenant + unit + caller', async () => {
    let whereCalls = 0;
    const db = {
      execute: async () => undefined,
      select: () => ({
        from: () => ({
          where: async () => {
            whereCalls += 1;
            return [
              {
                id: 'neg-a',
                tenantId: TEST_TENANT,
                unitId: 'unit-7',
                prospectCustomerId: TEST_USER,
                status: 'open',
              },
            ];
          },
        }),
      }),
    };
    const app = mountWithContext({ db });

    const res = await app.request(
      '/customer/marketplace/unit-7/negotiations',
      { headers: { Authorization: bearer() } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('neg-a');
    expect(whereCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8 + 9. Honest empty stubs — utilities + community
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
// /me/dashboard — P0 SECURITY FIX regression test
//
// The previous implementation fetched whole-tenant leases / invoices /
// payments then JS-filtered by customerId. That meant other customers'
// rows were materialised on every dashboard hit. This suite locks in
// the new behaviour: the BFF MUST call the customer-scoped repo
// methods, NOT findMany.
// ---------------------------------------------------------------------------

describe('GET /customer/me/dashboard (P0 customer-scoping)', () => {
  it('rejects anonymous callers (401)', async () => {
    const app = mountWithContext();
    const res = await app.request('/customer/me/dashboard');
    expect(res.status).toBe(401);
  });

  it('uses findByCustomer on leases / invoices / payments (not findMany)', async () => {
    const calls: string[] = [];
    const repos = {
      leases: {
        findByCustomer: async (cid: string) => {
          calls.push(`leases.findByCustomer(${cid})`);
          return {
            items: [
              {
                id: 'lease-1',
                customerId: cid,
                status: 'active',
              },
            ],
            total: 1,
          };
        },
        findMany: async () => {
          calls.push('leases.findMany');
          return { items: [], total: 0 };
        },
      },
      invoices: {
        findByCustomer: async (cid: string) => {
          calls.push(`invoices.findByCustomer(${cid})`);
          return {
            items: [
              { id: 'inv-1', customerId: cid, status: 'sent', amountDue: 1000 },
            ],
            total: 1,
          };
        },
        findMany: async () => {
          calls.push('invoices.findMany');
          return { items: [], total: 0 };
        },
      },
      payments: {
        findByCustomer: async (cid: string) => {
          calls.push(`payments.findByCustomer(${cid})`);
          return {
            items: [{ id: 'pay-1', customerId: cid, amount: 500 }],
            total: 1,
          };
        },
        findMany: async () => {
          calls.push('payments.findMany');
          return { items: [], total: 0 };
        },
      },
    };
    const app = mountWithContext({ repos });

    const res = await app.request('/customer/me/dashboard', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.activeLease).toMatchObject({ id: 'lease-1', status: 'active' });
    expect(body.data.openBalance).toBe(1000);
    expect(body.data.recentInvoices).toHaveLength(1);
    expect(body.data.recentPayments).toHaveLength(1);

    // The P0 contract: findByCustomer MUST be called on all three
    // repos, and findMany MUST NEVER be reached.
    expect(calls).toEqual(
      expect.arrayContaining([
        `leases.findByCustomer(${TEST_USER})`,
        `invoices.findByCustomer(${TEST_USER})`,
        `payments.findByCustomer(${TEST_USER})`,
      ]),
    );
    expect(calls).not.toContain('leases.findMany');
    expect(calls).not.toContain('invoices.findMany');
    expect(calls).not.toContain('payments.findMany');
  });

  it('returns 503 when repos are unavailable', async () => {
    const app = mountWithContext({ repos: null });
    const res = await app.request('/customer/me/dashboard', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
  });
});
