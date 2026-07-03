/**
 * Seller-side bid lifecycle authorization gate.
 *
 * The seller-side bid actions — accept, reject, and offtake-sign —
 * crystallize a binding commercial contract and enqueue the money leg
 * (`settlement.requested`). They MUST be restricted to the seller-org's
 * authorized principals (OWNER / TENANT_ADMIN / ACCOUNTANT / SUPER_ADMIN),
 * exactly matching the sibling cooperative-settlement money route's
 * SETTLEMENT_WRITE_ROLES gate. A low-privilege member (field worker /
 * self-registered buyer mapped to MAINTENANCE_STAFF / RESIDENT) must be
 * refused with 403 — never allowed to sign the tenant into settlement.
 *
 * This test drives the REAL `requireRole` middleware (it does NOT mock
 * `hono-auth`), so a regression that drops the gate turns the EMPLOYEE
 * cases green and fails the suite. The DB + downstream services are the
 * only things faked, so an authorized OWNER still reaches a 200.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Preserve the REAL `requireRole` (the gate under test) while replacing only
// `authMiddleware` with a pass-through — the router applies the real
// `authMiddleware` via `app.use('*', ...)`, which would 401 without a JWT and
// overwrite the seeded auth context. Seeding auth on the outer app + a
// pass-through authMiddleware lets the genuine `requireRole` evaluate the role.
vi.mock('../../../middleware/hono-auth', async (original) => {
  const real = await original<typeof import('../../../middleware/hono-auth')>();
  return {
    ...real,
    authMiddleware: async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  };
});
vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

// Downstream side effects are irrelevant to the authorization contract —
// stub them so the OWNER (allowed) path reaches a 200 without a real DB.
vi.mock('../../../services/cockpit-events', () => ({
  publishCockpitEvent: vi.fn(),
}));
vi.mock('../../../services/buyer-notifications', () => ({
  enqueueBidOutcomeNotification: vi.fn(async () => {}),
}));
vi.mock('../../../services/offtake-settlement', () => ({
  enqueueSettlementRequested: vi.fn(async () => {}),
}));

// Minimal drizzle column markers + predicate helpers. The handler only
// needs `eq` / `and` / `desc` to be callable; the fake db ignores the
// predicates and serves rows from a scripted queue.
vi.mock('drizzle-orm', async (original) => {
  const real = await original<typeof import('drizzle-orm')>();
  return {
    ...real,
    eq: () => ({}),
    and: () => ({}),
    desc: (col: unknown) => col,
  };
});

vi.mock('@borjie/database', () => ({
  marketplaceBids: {},
  marketplaceListings: {},
  offtakeAgreements: {},
  buyers: {},
}));

import { Hono } from 'hono';
import { requireRole } from '../../../middleware/hono-auth';
import { miningBidsRouter } from '../bids.hono';

const TENANT = 'tenant-mine-a';
const BID_ID = 'bid-0000-1111-2222-3333';

/**
 * Fake drizzle client. Every builder method chains; the terminal awaits
 * (`.limit()` / `.returning()` / thenable) shift the next scripted result
 * off `queue`. For the reject flow the queue supplies, in order:
 *   1. setBidStatus SELECT  → the pending bid row
 *   2. setBidStatus UPDATE  → the updated (rejected) row
 *   3. resolveBuyerUserId   → [] (no linked user → notification skipped)
 */
function makeDb(queue: unknown[][]) {
  let i = 0;
  const nextResult = () => (i < queue.length ? queue[i++] : []);
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of [
    'select',
    'from',
    'where',
    'set',
    'update',
    'insert',
    'values',
    'orderBy',
  ]) {
    builder[m] = chain;
  }
  builder.limit = async () => nextResult();
  builder.returning = async () => nextResult();
  builder.then = (resolve: (v: unknown) => void) =>
    Promise.resolve(nextResult()).then(resolve);
  const db: Record<string, unknown> = {
    ...builder,
    async transaction(cb: (tx: unknown) => Promise<unknown>) {
      return cb(db);
    },
  };
  return db;
}

function buildApp(role: string, db: unknown) {
  const app = new Hono();
  // Seed the auth context the REAL requireRole middleware reads.
  app.use('*', async (c, next) => {
    c.set('auth', { tenantId: TENANT, userId: 'user-1', role });
    c.set('db', db);
    await next();
  });
  app.route('/', miningBidsRouter);
  return app;
}

const pendingBid = {
  id: BID_ID,
  tenantId: TENANT,
  listingId: 'listing-1',
  buyerId: 'buyer-1',
  bidPriceTzs: '1000000',
  paymentTerms: null,
  status: 'pending',
  attributes: {},
  acceptedAt: null,
};

const rejectedBid = { ...pendingBid, status: 'rejected' };

function rejectQueue() {
  return [
    [pendingBid], // setBidStatus SELECT
    [rejectedBid], // setBidStatus UPDATE .returning()
    [], // resolveBuyerUserId → no linked user
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('seller-side bid lifecycle — role gate (matches settlement money tier)', () => {
  it('sanity: requireRole is the REAL middleware, not a pass-through stub', async () => {
    // A pass-through mock would let a bare handler through; the real one
    // 403s an unlisted role. Assert the shape so the mutation-proof holds.
    const probe = new Hono();
    probe.use('*', async (c, next) => {
      c.set('auth', { tenantId: TENANT, userId: 'u', role: 'MAINTENANCE_STAFF' });
      await next();
    });
    probe.post('/x', requireRole('OWNER'), (c) => c.json({ ok: true }));
    const res = await probe.request('/x', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('rejects a low-privilege member (field worker) on POST /:id/reject with 403', async () => {
    const app = buildApp('MAINTENANCE_STAFF', makeDb(rejectQueue()));
    const res = await app.request(`/${BID_ID}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'not-my-call' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a self-registered buyer role (RESIDENT) on POST /:id/reject with 403', async () => {
    const app = buildApp('RESIDENT', makeDb(rejectQueue()));
    const res = await app.request(`/${BID_ID}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'not-my-call' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a low-privilege member on POST /offtake-agreements/:id/sign with 403 (money leg gated)', async () => {
    const app = buildApp('MAINTENANCE_STAFF', makeDb([]));
    const res = await app.request(
      `/offtake-agreements/agreement-0000-1111-2222/sign`,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
    );
    expect(res.status).toBe(403);
  });

  it('allows an authorized OWNER on POST /:id/reject (gate does not over-restrict)', async () => {
    const app = buildApp('OWNER', makeDb(rejectQueue()));
    const res = await app.request(`/${BID_ID}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'price-too-low' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('rejected');
  });

  it('allows an ACCOUNTANT on POST /:id/reject (settlement-tier role, matches sibling gate)', async () => {
    const app = buildApp('ACCOUNTANT', makeDb(rejectQueue()));
    const res = await app.request(`/${BID_ID}/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'price-too-low' }),
    });
    expect(res.status).toBe(200);
  });
});
