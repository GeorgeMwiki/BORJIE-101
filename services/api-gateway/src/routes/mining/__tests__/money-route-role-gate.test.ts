/**
 * Money-mutating route authorization gate (fail-open-authz class closeout).
 *
 * These routes each move real money through `LedgerService.post()` or
 * crystallize a binding money obligation:
 *   - POST /api/v1/mining/royalty/:id/sign  → postRoyaltyPayment (FILE + PAY)
 *   - POST /api/v1/mining/sales             → postSaleProceeds (sale revenue)
 *   - POST /api/v1/mining/procurement-coordination/requisitions
 *                                           → postBudgetEncumbrance (budget)
 *
 * Before round 9 they were protected ONLY by `authMiddleware` (any
 * authenticated tenant member), so a low-privilege member (field worker
 * mapped to MAINTENANCE_STAFF, self-registered buyer mapped to RESIDENT)
 * could move money. They MUST be restricted to the accounting/ownership tier
 * (OWNER / TENANT_ADMIN / ACCOUNTANT / SUPER_ADMIN) — exactly matching the
 * sibling bids SELLER_WRITE_ROLES + cooperative-settlement
 * SETTLEMENT_WRITE_ROLES gates.
 *
 * This suite drives the REAL `requireRole` middleware (it does NOT mock the
 * gate), so a regression that drops any gate turns the unauthorized-role
 * cases green and fails the suite. Only the DB + downstream ledger services
 * are faked, so an authorized OWNER still reaches a success status.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Preserve the REAL `requireRole` (the gate under test); replace only
// `authMiddleware` with a pass-through so the seeded auth context on the
// outer app survives to `requireRole`.
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

// Downstream money + telemetry side effects are irrelevant to the
// authorization contract — stub them so the OWNER (allowed) path reaches a
// success status without a real ledger. A returned journalId proves the
// handler ran past the gate.
vi.mock('../../../services/royalty/royalty-ledger', () => ({
  postRoyaltyPayment: vi.fn(async () => ({
    journalId: 'jrnl-royalty-1',
    currency: 'TZS',
    amountMinorUnits: 1000,
  })),
}));
vi.mock('../../../composition/ledger/post-sale-proceeds', () => ({
  postSaleProceeds: vi.fn(async () => ({ journalId: 'jrnl-sale-1' })),
  postBudgetEncumbrance: vi.fn(async () => ({ journalId: 'jrnl-enc-1' })),
}));
vi.mock('../../../services/activation-events/record-activation-event', () => ({
  recordActivationEvent: vi.fn(async () => {}),
}));
vi.mock('../../../services/cockpit-events', () => ({
  publishCockpitEvent: vi.fn(),
}));

vi.mock('drizzle-orm', async (original) => {
  const real = await original<typeof import('drizzle-orm')>();
  return {
    ...real,
    eq: () => ({}),
    and: () => ({}),
    desc: (col: unknown) => col,
    gte: () => ({}),
    lt: () => ({}),
  };
});

vi.mock('@borjie/database', () => ({
  sales: {},
  oreParcels: {},
  listLedgerLines: vi.fn(async () => []),
}));

// The procurement-coordination platform + data port are stubbed so the
// authorized path runs the handler past the gate without a real package/DB.
// createRequisition returns a row with an id + estimatedTotal so the
// encumbrance (stubbed postBudgetEncumbrance above) fires and the handler 201s.
vi.mock('@borjie/procurement-coordination', () => ({
  createProcurementCoordination: vi.fn(() => ({
    requisitions: {
      createRequisition: vi.fn(async () => ({
        id: 'req-1',
        estimatedTotal: 1000,
        currency: 'TZS',
      })),
    },
  })),
  computeAvailability: vi.fn(() => ({})),
}));
vi.mock('../../../composition/procurement/drizzle-data-port', () => ({
  createDrizzleProcurementDataPort: vi.fn(() => ({
    listVendors: vi.fn(async () => []),
  })),
}));

import { Hono } from 'hono';
import { requireRole } from '../../../middleware/hono-auth';
import { miningRoyaltyRouter } from '../royalty.hono';
import { miningSalesRouter } from '../sales.hono';
import { miningProcurementCoordinationRouter } from '../procurement-coordination.hono';

const TENANT = 'tenant-mine-a';
const DRAFT_ID = '11111111-2222-3333-4444-555555555555';
const PARCEL_ID = '99999999-8888-7777-6666-555555555555';

/**
 * Fake drizzle client. Terminal awaits shift the next scripted result off the
 * queue; `db.execute` and the query-builder chain both consume it. A
 * `transaction` runs its callback against the same fake so the sales tx path
 * works. For the royalty SIGN path the queue supplies, in order:
 *   1. load draft SELECT → the not-yet-signed draft row
 *   (the UPDATE + audit-append + activation writes return [])
 * For the sales CREATE path the tx supplies:
 *   1. FOR UPDATE parcel lock → an in_stockpile parcel row
 *   2. sales INSERT .returning() → the created sale row
 */
function makeDb(queue: unknown[][]) {
  let i = 0;
  const nextResult = () => (i < queue.length ? queue[i++]! : []);
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
    async execute() {
      return nextResult();
    },
    async transaction(cb: (tx: unknown) => Promise<unknown>) {
      return cb(db);
    },
  };
  return db;
}

function buildApp(router: Hono, role: string, db: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth', { tenantId: TENANT, userId: 'user-1', role });
    c.set('db', db);
    await next();
  });
  app.route('/', router);
  return app;
}

const royaltyDraft = {
  id: DRAFT_ID,
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  mineral: 'gold',
  status: 'draft',
  notes: {},
};

function royaltyQueue() {
  return [
    [royaltyDraft], // load draft SELECT
    [], // UPDATE flip
    [], // audit-chain append (best-effort)
    [], // activation event
  ];
}

const parcelRow = { id: PARCEL_ID, status: 'in_stockpile' };
const saleRow = {
  id: 'sale-1',
  tenantId: TENANT,
  parcelId: PARCEL_ID,
  paymentStatus: 'unpaid',
};

function salesQueue() {
  return [
    [parcelRow], // FOR UPDATE parcel lock (db.execute)
    [saleRow], // sales INSERT .returning()
    [], // parcel UPDATE status=sold
    [], // activation event
  ];
}

const validRequisition = {
  requestedBy: 'user-1',
  items: [
    {
      description: 'excavator hire',
      qty: 1,
      unit: 'unit',
      estimatedUnitPrice: 1000,
      currency: 'TZS',
      subtotal: 1000,
    },
  ],
  justification: 'field operations continuity',
};

const validSign = { confirm: true as const, royaltyAmount: 1000 };
// route + paymentStatus default in the SaleCreate schema; grossPriceTzs is a
// nullable STRING column, so it is supplied as a string when present. The
// minimal valid body is just the parcelId.
const validSale = {
  parcelId: PARCEL_ID,
  grossPriceTzs: '1000',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('money-route role gate — sanity', () => {
  it('requireRole is the REAL middleware, not a pass-through stub', async () => {
    const probe = new Hono();
    probe.use('*', async (c, next) => {
      c.set('auth', { tenantId: TENANT, userId: 'u', role: 'MAINTENANCE_STAFF' });
      await next();
    });
    probe.post('/x', requireRole('OWNER'), (c) => c.json({ ok: true }));
    const res = await probe.request('/x', { method: 'POST' });
    expect(res.status).toBe(403);
  });
});

describe('POST /mining/royalty/:id/sign — accounting-tier gate', () => {
  it('rejects a field worker (MAINTENANCE_STAFF) with 403', async () => {
    const app = buildApp(miningRoyaltyRouter, 'MAINTENANCE_STAFF', makeDb(royaltyQueue()));
    const res = await app.request(`/${DRAFT_ID}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSign),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a self-registered buyer (RESIDENT) with 403', async () => {
    const app = buildApp(miningRoyaltyRouter, 'RESIDENT', makeDb(royaltyQueue()));
    const res = await app.request(`/${DRAFT_ID}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSign),
    });
    expect(res.status).toBe(403);
  });

  it('allows an OWNER to file + pay (gate does not over-restrict)', async () => {
    const app = buildApp(miningRoyaltyRouter, 'OWNER', makeDb(royaltyQueue()));
    const res = await app.request(`/${DRAFT_ID}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSign),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.journalId).toBe('jrnl-royalty-1');
  });

  it('allows an ACCOUNTANT (accounting-tier role) to file + pay', async () => {
    const app = buildApp(miningRoyaltyRouter, 'ACCOUNTANT', makeDb(royaltyQueue()));
    const res = await app.request(`/${DRAFT_ID}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSign),
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /mining/sales — accounting-tier gate', () => {
  it('rejects a field worker (MAINTENANCE_STAFF) with 403', async () => {
    const app = buildApp(miningSalesRouter, 'MAINTENANCE_STAFF', makeDb(salesQueue()));
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSale),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a self-registered buyer (RESIDENT) with 403', async () => {
    const app = buildApp(miningSalesRouter, 'RESIDENT', makeDb(salesQueue()));
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSale),
    });
    expect(res.status).toBe(403);
  });

  it('allows an OWNER to record a sale (gate does not over-restrict)', async () => {
    const app = buildApp(miningSalesRouter, 'OWNER', makeDb(salesQueue()));
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSale),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('allows an ACCOUNTANT (accounting-tier role) to record a sale', async () => {
    const app = buildApp(miningSalesRouter, 'ACCOUNTANT', makeDb(salesQueue()));
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSale),
    });
    expect(res.status).toBe(201);
  });
});

describe('POST /mining/procurement-coordination/requisitions — accounting-tier gate', () => {
  it('rejects a field worker (MAINTENANCE_STAFF) with 403', async () => {
    const app = buildApp(
      miningProcurementCoordinationRouter,
      'MAINTENANCE_STAFF',
      makeDb([]),
    );
    const res = await app.request('/requisitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validRequisition),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a self-registered buyer (RESIDENT) with 403', async () => {
    const app = buildApp(
      miningProcurementCoordinationRouter,
      'RESIDENT',
      makeDb([]),
    );
    const res = await app.request('/requisitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validRequisition),
    });
    expect(res.status).toBe(403);
  });

  it('allows an OWNER to create a requisition + encumber budget (gate does not over-restrict)', async () => {
    const app = buildApp(miningProcurementCoordinationRouter, 'OWNER', makeDb([]));
    const res = await app.request('/requisitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validRequisition),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('allows an ACCOUNTANT (accounting-tier role) to create a requisition', async () => {
    const app = buildApp(
      miningProcurementCoordinationRouter,
      'ACCOUNTANT',
      makeDb([]),
    );
    const res = await app.request('/requisitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validRequisition),
    });
    expect(res.status).toBe(201);
  });
});
