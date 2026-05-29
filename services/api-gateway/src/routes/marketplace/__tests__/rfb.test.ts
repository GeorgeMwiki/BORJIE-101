import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

// Stub the auth + database middleware BEFORE importing the router so
// the test fixture is fully self-contained — no JWT_SECRET required.
vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));
vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import rfbRouter from '../rfb.hono';

// ---------------------------------------------------------------------------
// In-memory DB stub — enough to drive the route handler tests without a
// live Postgres. We capture the executed SQL templates and return
// scripted rows so each assertion is deterministic.
// ---------------------------------------------------------------------------

interface Recorded {
  fragments: ReadonlyArray<string>;
  params: ReadonlyArray<unknown>;
}

function makeDb(responder: (rec: Recorded) => unknown) {
  const calls: Recorded[] = [];
  const execute = async (q: unknown) => {
    if (q && typeof q === 'object' && 'queryChunks' in q) {
      const chunks = (q as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [];
      const fragments: string[] = [];
      const params: unknown[] = [];
      for (const c of chunks) {
        if (c && typeof c === 'object' && 'value' in c) {
          fragments.push((c as { value: string }).value);
        } else if (c && typeof c === 'object' && 'queryChunks' in c) {
          // Nested SQL — flatten in place.
          const inner = (c as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [];
          for (const ic of inner) {
            if (ic && typeof ic === 'object' && 'value' in ic) {
              fragments.push((ic as { value: string }).value);
            }
          }
        } else {
          params.push(c);
        }
      }
      const rec = { fragments, params };
      calls.push(rec);
      return responder(rec);
    }
    return { rows: [] };
  };
  return {
    db: { execute },
    calls,
  };
}

// Minimal auth middleware stub so we can drive c.get('auth') / c.get('db').
function buildApp(stubs: {
  authResp?: { tenantId?: string; userId?: string } | null;
  db: ReturnType<typeof makeDb>['db'];
}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (stubs.authResp !== null) {
      c.set(
        'auth',
        stubs.authResp ?? {
          tenantId: 'tenant-a',
          userId: 'buyer-1',
        },
      );
    }
    c.set('db', stubs.db);
    await next();
  });
  app.route('/', rfbRouter);
  return app;
}

const FUTURE_DATE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
})();

const PAST_DATE = '2020-01-01';

describe('R11 RFB — POST /', () => {
  it('rejects when tonnageMax < tonnageMin', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mineralKind: 'gold',
        tonnageMin: 100,
        tonnageMax: 50,
        unitPriceTzs: 60_000_000,
        deliveryBy: FUTURE_DATE,
        radiusKm: 200,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_TONNAGE_RANGE');
    expect(body.error.message.sw).toContain('Tonnage ya juu');
  });

  it('rejects when deliveryBy is in the past', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mineralKind: 'gold',
        tonnageMin: 100,
        unitPriceTzs: 60_000_000,
        deliveryBy: PAST_DATE,
        radiusKm: 200,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('DELIVERY_IN_PAST');
  });

  it('inserts a valid RFB and returns the new id', async () => {
    const { db, calls } = makeDb(() => ({
      rows: [
        {
          id: 'rfb-uuid-xyz',
          created_at: '2026-05-29T10:00:00Z',
          expires_at: '2026-06-12T10:00:00Z',
        },
      ],
    }));
    const app = buildApp({ db });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mineralKind: 'tanzanite',
        tonnageMin: 10,
        unitPriceTzs: 1_500_000,
        deliveryBy: FUTURE_DATE,
        radiusKm: 200,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('rfb-uuid-xyz');
    // Confirm we wrote to request_for_bids (one INSERT call).
    expect(calls.length).toBe(1);
    expect(calls[0]?.fragments.join('')).toContain('INSERT INTO request_for_bids');
  });

  it('rejects an invalid mineral kind via zod', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mineralKind: 'unobtanium',
        tonnageMin: 10,
        unitPriceTzs: 100,
        deliveryBy: FUTURE_DATE,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('R11 RFB — GET /mine', () => {
  it('returns the buyer\'s own RFBs', async () => {
    const { db } = makeDb(() => ({
      rows: [
        {
          id: 'rfb-1',
          mineral_kind: 'gold',
          status: 'open',
          pending_response_count: 2,
        },
      ],
    }));
    const app = buildApp({ db });
    const res = await app.request('/mine');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rfbs).toHaveLength(1);
    expect(body.data.rfbs[0].id).toBe('rfb-1');
    expect(body.data.rfbs[0].pending_response_count).toBe(2);
  });
});

describe('R11 RFB — PATCH /:id', () => {
  it('cancels an open RFB owned by the buyer', async () => {
    const { db } = makeDb(() => ({
      rows: [{ id: 'rfb-1', status: 'cancelled' }],
    }));
    const app = buildApp({ db });
    const res = await app.request('/rfb-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('cancelled');
  });

  it('returns 404 when the row is not open / not owned', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request('/rfb-zzz', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('RFB_NOT_FOUND_OR_NOT_OPEN');
    expect(body.error.message.sw).toContain('RFB');
  });
});

describe('R11 RFB — POST /:id/respond', () => {
  it('rejects when the parent RFB is not open', async () => {
    // First call: SELECT returns empty (no open RFB). Insert is
    // never reached.
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request('/rfb-1/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offeredTonnage: 50,
        offeredPriceTzs: 55_000_000,
        deliveryBy: FUTURE_DATE,
      }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('RFB_NOT_OPEN');
  });

  it('inserts a response when the RFB is open', async () => {
    let call = 0;
    const { db, calls } = makeDb(() => {
      call += 1;
      if (call === 1) {
        // SELECT — the RFB is open.
        return { rows: [{ tenant_id: 'tenant-buyer', status: 'open' }] };
      }
      // INSERT — return the new response id.
      return { rows: [{ id: 'resp-1', created_at: '2026-05-29T11:00:00Z' }] };
    });
    const app = buildApp({
      authResp: { tenantId: 'tenant-seller', userId: 'seller-1' },
      db,
    });
    const res = await app.request('/rfb-1/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        offeredTonnage: 50,
        offeredPriceTzs: 55_000_000,
        deliveryBy: FUTURE_DATE,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe('resp-1');
    expect(calls.length).toBe(2);
    expect(calls[1]?.fragments.join('')).toContain(
      'INSERT INTO request_for_bid_responses',
    );
  });
});

// ---------------------------------------------------------------------------
// L3 — POST /:id/dispatch (owner → manager)
// ---------------------------------------------------------------------------

const VALID_UUID = '11111111-2222-3333-4444-555555555555';
const VALID_SITE_ID = '22222222-3333-4444-5555-666666666666';
const VALID_MANAGER_ID = '33333333-4444-5555-6666-777777777777';

describe('R11 RFB — POST /:id/dispatch', () => {
  it('returns 404 when RFB not found in tenant', async () => {
    // SELECT returns empty — RFB doesn't belong to this tenant.
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request(`/${VALID_UUID}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        managerId: VALID_MANAGER_ID,
        siteId: VALID_SITE_ID,
      }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('RFB_NOT_FOUND');
    expect(body.error.message.sw).toContain('RFB');
  });

  it('returns 409 when RFB is not open', async () => {
    const { db } = makeDb(() => ({
      rows: [
        {
          id: VALID_UUID,
          status: 'filled',
          mineral_kind: 'gold',
          tonnage_min: '10',
        },
      ],
    }));
    const app = buildApp({ db });
    const res = await app.request(`/${VALID_UUID}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        managerId: VALID_MANAGER_ID,
        siteId: VALID_SITE_ID,
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('RFB_NOT_OPEN');
  });

  it('creates an rfb_fulfill mining_tasks row and returns the task id', async () => {
    let call = 0;
    const { db, calls } = makeDb(() => {
      call += 1;
      if (call === 1) {
        // SELECT — open RFB in the tenant.
        return {
          rows: [
            {
              id: VALID_UUID,
              status: 'open',
              mineral_kind: 'tanzanite',
              tonnage_min: '8',
            },
          ],
        };
      }
      // INSERT — return the new task id.
      return {
        rows: [
          {
            id: 'task-uuid-aaa',
            created_at: '2026-05-29T12:00:00Z',
            kind: 'rfb_fulfill',
            parent_rfb_id: VALID_UUID,
          },
        ],
      };
    });
    const app = buildApp({ db });
    const res = await app.request(`/${VALID_UUID}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        managerId: VALID_MANAGER_ID,
        siteId: VALID_SITE_ID,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.taskId).toBe('task-uuid-aaa');
    expect(body.data.rfbId).toBe(VALID_UUID);
    expect(body.data.managerId).toBe(VALID_MANAGER_ID);
    expect(body.data.siteId).toBe(VALID_SITE_ID);
    // Two SQL calls: SELECT then INSERT.
    expect(calls.length).toBe(2);
    expect(calls[1]?.fragments.join('')).toContain('INSERT INTO mining_tasks');
    expect(calls[1]?.fragments.join('')).toContain('rfb_fulfill');
  });

  it('rejects when managerId is not a UUID', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request(`/${VALID_UUID}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        managerId: 'not-a-uuid',
        siteId: VALID_SITE_ID,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 when no auth context is present', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ authResp: null, db });
    const res = await app.request(`/${VALID_UUID}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        managerId: VALID_MANAGER_ID,
        siteId: VALID_SITE_ID,
      }),
    });
    expect(res.status).toBe(503);
  });
});
