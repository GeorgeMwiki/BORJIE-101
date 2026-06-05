/**
 * WS-2 — bid-messaging.hono router tests (RFB → respond → MESSAGE →
 * sign → RATE loop).
 *
 * These tests were written FIRST and reproduce the stub gaps:
 *   - apps/buyer-mobile sendBidMessage / fetchBids had NO backend.
 *   - there was no post-settlement seller rating + reputation surface.
 *
 * Harness mirrors marketplace/__tests__/rfb.test.ts: stub the auth +
 * database middleware, then drive a captured-SQL in-memory db.execute
 * so each assertion is deterministic without a live Postgres.
 */

import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

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

import { miningBidMessagingRouter } from '../bid-messaging.hono';

interface Recorded {
  fragments: ReadonlyArray<string>;
  params: ReadonlyArray<unknown>;
}

function makeDb(responder: (rec: Recorded, callIndex: number) => unknown) {
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
      return responder(rec, calls.length - 1);
    }
    return { rows: [] };
  };
  return { db: { execute }, calls };
}

function buildApp(stubs: {
  authResp?: { tenantId?: string; userId?: string } | null;
  db: ReturnType<typeof makeDb>['db'];
}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (stubs.authResp !== null) {
      c.set('auth', stubs.authResp ?? { tenantId: 'tenant-buyer', userId: 'buyer-1' });
    }
    c.set('db', stubs.db);
    await next();
  });
  app.route('/', miningBidMessagingRouter);
  return app;
}

const RESPONSE_ID = '11111111-2222-3333-4444-555555555555';
const SETTLEMENT_ID = '99999999-8888-7777-6666-555555555555';

// ---------------------------------------------------------------------------
// GET /threads/:responseId/messages
// ---------------------------------------------------------------------------

describe('WS-2 bid-messaging — GET /threads/:responseId/messages', () => {
  it('returns 503 with no auth context', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ authResp: null, db });
    const res = await app.request(`/threads/${RESPONSE_ID}/messages`);
    expect(res.status).toBe(503);
  });

  it('400 on a non-UUID responseId', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request('/threads/not-a-uuid/messages');
    expect(res.status).toBe(400);
  });

  it('404 when the caller is not a participant in the thread', async () => {
    // participant lookup returns empty → caller not buyer/seller tenant.
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request(`/threads/${RESPONSE_ID}/messages`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('THREAD_NOT_FOUND');
  });

  it('returns the thread oldest-first when the caller participates', async () => {
    const { db, calls } = makeDb((_rec, i) => {
      if (i === 0) {
        // participant lookup — caller is the buyer tenant.
        return {
          rows: [
            {
              rfb_id: 'rfb-1',
              buyer_tenant_id: 'tenant-buyer',
              seller_tenant_id: 'tenant-seller',
            },
          ],
        };
      }
      // messages
      return {
        rows: [
          { id: 'm1', sender_role: 'buyer', body: 'Hello', created_at: '2026-06-01T10:00:00Z' },
          { id: 'm2', sender_role: 'seller', body: 'Hi there', created_at: '2026-06-01T10:05:00Z' },
        ],
      };
    });
    const app = buildApp({ db });
    const res = await app.request(`/threads/${RESPONSE_ID}/messages`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.messages[0].body).toBe('Hello');
    // The thread query selects from bid_messages ordered ASC.
    expect(calls[1]?.fragments.join('')).toContain('FROM bid_messages');
  });
});

// ---------------------------------------------------------------------------
// POST /threads/:responseId/messages  (idempotent send)
// ---------------------------------------------------------------------------

describe('WS-2 bid-messaging — POST /threads/:responseId/messages', () => {
  it('400 when body is empty', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request(`/threads/${RESPONSE_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('403 when the sender is not a participant', async () => {
    // participant lookup empty.
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request(`/threads/${RESPONSE_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hi' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_THREAD_PARTICIPANT');
  });

  it('inserts a message as the buyer and returns 201', async () => {
    const { db, calls } = makeDb((_rec, i) => {
      if (i === 0) {
        return {
          rows: [
            {
              rfb_id: 'rfb-1',
              buyer_tenant_id: 'tenant-buyer',
              seller_tenant_id: 'tenant-seller',
            },
          ],
        };
      }
      // INSERT … RETURNING
      return {
        rows: [
          {
            id: 'new-msg-1',
            sender_role: 'buyer',
            body: 'I can collect Friday',
            created_at: '2026-06-02T09:00:00Z',
          },
        ],
      };
    });
    const app = buildApp({ db });
    const res = await app.request(`/threads/${RESPONSE_ID}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'I can collect Friday' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe('new-msg-1');
    expect(body.data.senderRole).toBe('buyer');
    expect(calls[1]?.fragments.join('')).toContain('INSERT INTO bid_messages');
  });

  it('is idempotent — a replay with the same Idempotency-Key short-circuits', async () => {
    const { db, calls } = makeDb((_rec, i) => {
      if (i === 0) {
        return {
          rows: [
            {
              rfb_id: 'rfb-1',
              buyer_tenant_id: 'tenant-buyer',
              seller_tenant_id: 'tenant-seller',
            },
          ],
        };
      }
      if (i === 1) {
        // idempotency lookup HIT — the row already exists.
        return {
          rows: [
            {
              id: 'existing-msg',
              sender_role: 'buyer',
              body: 'dup',
              created_at: '2026-06-02T09:00:00Z',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const app = buildApp({ db });
    const res = await app.request(`/threads/${RESPONSE_ID}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': 'key-abc',
      },
      body: JSON.stringify({ body: 'dup' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe('existing-msg');
    expect(body.meta?.idempotent).toBe(true);
    // No INSERT — only participant lookup + idempotency lookup ran.
    const insertCalls = calls.filter((c) =>
      c.fragments.join('').includes('INSERT INTO bid_messages'),
    );
    expect(insertCalls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /settlements/:settlementId/rate  (post-settlement)
// ---------------------------------------------------------------------------

describe('WS-2 seller-ratings — POST /settlements/:settlementId/rate', () => {
  it('400 when stars are out of range', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request(`/settlements/${SETTLEMENT_ID}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stars: 9 }),
    });
    expect(res.status).toBe(400);
  });

  it('404 when the settlement is absent / not the caller\'s', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const res = await app.request(`/settlements/${SETTLEMENT_ID}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stars: 5 }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('SETTLEMENT_NOT_FOUND');
  });

  it('409 when the settlement has not reached a settled state', async () => {
    const { db } = makeDb((_rec, i) => {
      if (i === 0) {
        return {
          rows: [
            {
              id: SETTLEMENT_ID,
              status: 'pending',
              response_id: RESPONSE_ID,
              seller_id: 'seller-1',
              seller_tenant_id: 'tenant-seller',
              buyer_id: 'buyer-1',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const app = buildApp({ db });
    const res = await app.request(`/settlements/${SETTLEMENT_ID}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stars: 5 }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('SETTLEMENT_NOT_SETTLED');
  });

  it('inserts a rating for a posted settlement and returns 201', async () => {
    const { db, calls } = makeDb((_rec, i) => {
      if (i === 0) {
        return {
          rows: [
            {
              id: SETTLEMENT_ID,
              status: 'completed',
              response_id: RESPONSE_ID,
              seller_id: 'seller-1',
              seller_tenant_id: 'tenant-seller',
              buyer_id: 'buyer-1',
            },
          ],
        };
      }
      // INSERT … ON CONFLICT … RETURNING
      return {
        rows: [{ id: 'rating-1', stars: 5, created_at: '2026-06-02T12:00:00Z' }],
      };
    });
    const app = buildApp({ db });
    const res = await app.request(`/settlements/${SETTLEMENT_ID}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stars: 5, comment: 'Great seller' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe('rating-1');
    expect(body.data.stars).toBe(5);
    expect(calls[1]?.fragments.join('')).toContain('INSERT INTO seller_ratings');
  });

  it('403 when the caller is not the settlement buyer', async () => {
    const { db } = makeDb((_rec, i) => {
      if (i === 0) {
        return {
          rows: [
            {
              id: SETTLEMENT_ID,
              status: 'completed',
              response_id: RESPONSE_ID,
              seller_id: 'seller-1',
              seller_tenant_id: 'tenant-seller',
              buyer_id: 'someone-else',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const app = buildApp({ db });
    const res = await app.request(`/settlements/${SETTLEMENT_ID}/rate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stars: 4 }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_SETTLEMENT_BUYER');
  });
});

// ---------------------------------------------------------------------------
// GET /reputation/:sellerTenantId
// ---------------------------------------------------------------------------

describe('WS-2 seller-ratings — GET /reputation/:sellerTenantId', () => {
  it('returns the reputation aggregate for a seller', async () => {
    const { db, calls } = makeDb(() => ({
      rows: [{ rating_count: 7, average_stars: '4.43' }],
    }));
    const app = buildApp({ db });
    const res = await app.request('/reputation/tenant-seller');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ratingCount).toBe(7);
    expect(body.data.averageStars).toBeCloseTo(4.43);
    expect(calls[0]?.fragments.join('')).toContain('seller_reputation');
  });

  it('returns a zeroed aggregate for an unrated seller', async () => {
    const { db } = makeDb(() => ({
      rows: [{ rating_count: 0, average_stars: null }],
    }));
    const app = buildApp({ db });
    const res = await app.request('/reputation/tenant-nobody');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ratingCount).toBe(0);
    expect(body.data.averageStars).toBeNull();
  });
});
