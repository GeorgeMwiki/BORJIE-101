/**
 * Persona-tool retarget routes — smoke tests.
 *
 * Coverage for the small set of endpoints added in the
 * `feat(mining): N new endpoints surfaced by persona-tool audit` slice:
 *
 *   - GET /mining/bids/incoming        seller-side incoming bids
 *   - GET /mining/bids/mine            buyer-side own bids
 *   - POST /mining/bids/:id/withdraw   buyer-side cancel
 *   - GET /mining/buyers/kyc/me        auto-resolved KYC status
 *   - POST /mining/buyers/kyc/upload-atom  chunked KYC upload
 *   - GET /mining/marketplace/market-intel commodity benchmark + trend
 *
 * Auth is gated on every route; happy-path tests rely on a tiny fake
 * Drizzle client that satisfies the handlers' shape requirements.
 * Cross-tenant denial is enforced by the production routes via RLS at
 * the SQL layer and by `auth.tenantId` predicates inline (CLAUDE.md
 * belt-and-braces rule). The fake-db tests confirm the predicate path
 * runs without throwing; the RLS gate is exercised by the
 * packages/database integration suite.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { miningBidsRouter } from '../bids.hono.js';
import { miningBuyersKycRouter } from '../buyers-kyc.hono.js';
import { miningMarketplaceRouter } from '../marketplace.hono.js';
import { generateToken } from '../../../middleware/auth.js';
import { UserRole } from '../../../types/user-role.js';

// ---------------------------------------------------------------------------
// Minimal stub db — only implements what the new routes touch.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeStubDb(seed: Record<string, Row[]> = {}) {
  const store = new Map<string, Row[]>();
  for (const [k, v] of Object.entries(seed)) {
    store.set(k, [...v]);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function tableName(table: any): string {
    for (const s of Object.getOwnPropertySymbols(table)) {
      if (s.toString().includes('Name')) {
        return (table as Record<symbol, string>)[s];
      }
    }
    return '';
  }
  function snakeToCamel(snake: string): string {
    return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function rowMatches(row: Row, cond: any): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => rowMatches(row, c));
    if (cond?.queries && Array.isArray(cond.queries)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return cond.queries.every((q: any) => rowMatches(row, q));
    }
    const col = cond?.left ?? cond?.column;
    const value = cond?.right ?? cond?.value;
    if (col && typeof col === 'object' && 'name' in col) {
      const colName = (col as { name: string }).name;
      const candidate = row[colName] ?? row[snakeToCamel(colName)];
      return candidate === value;
    }
    return true;
  }

  return {
    store,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select(..._args: any[]) {
      let activeTable = '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let filter: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        from(table: any) {
          activeTable = tableName(table);
          return builder;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        where(cond: any) {
          filter = cond;
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit() {
          return builder;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then(resolve: any) {
          const list = store.get(activeTable) ?? [];
          resolve(list.filter((r) => rowMatches(r, filter)));
        },
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert(table: any) {
      const name = tableName(table);
      if (!store.has(name)) store.set(name, []);
      return {
        values(rowOrRows: Row | Row[]) {
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
          const withDefaults = rows.map((r) => ({
            id: r.id ?? `stub-${Math.random().toString(36).slice(2, 10)}`,
            createdAt: r.createdAt ?? new Date(),
            ...r,
          }));
          store.get(name)!.push(...withDefaults);
          return {
            async returning() {
              return withDefaults;
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(table: any) {
      const name = tableName(table);
      return {
        set(changes: Row) {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            where(cond: any) {
              return {
                async returning() {
                  const list = store.get(name) ?? [];
                  const matched = list.filter((r) => rowMatches(r, cond));
                  for (let i = 0; i < list.length; i++) {
                    const cur = list[i]!;
                    if (rowMatches(cur, cond)) {
                      list[i] = { ...cur, ...changes };
                    }
                  }
                  return matched.map((m) => ({ ...m, ...changes }));
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                then(resolve: any) {
                  const list = store.get(name) ?? [];
                  for (let i = 0; i < list.length; i++) {
                    const cur = list[i]!;
                    if (rowMatches(cur, cond)) {
                      list[i] = { ...cur, ...changes };
                    }
                  }
                  resolve(undefined);
                },
              };
            },
          };
        },
      };
    },
    async execute() {
      return { rows: [] };
    },
  };
}

function bearer(
  role: UserRole,
  overrides?: { tenantId?: string; userId?: string },
): string {
  return `Bearer ${generateToken({
    userId: overrides?.userId ?? 'usr-test',
    tenantId: overrides?.tenantId ?? 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mountBids(db: ReturnType<typeof makeStubDb> | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (db) {
      // @ts-expect-error — db slot is augmented by databaseMiddleware
      c.set('db', db);
    }
    await next();
  });
  app.route('/api/v1/mining/bids', miningBidsRouter);
  return app;
}

function mountKyc(db: ReturnType<typeof makeStubDb> | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (db) {
      // @ts-expect-error — db slot is augmented by databaseMiddleware
      c.set('db', db);
    }
    await next();
  });
  app.route('/api/v1/mining/buyers', miningBuyersKycRouter);
  return app;
}

function mountMarketplace(db: ReturnType<typeof makeStubDb> | null) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (db) {
      // @ts-expect-error — db slot is augmented by databaseMiddleware
      c.set('db', db);
    }
    await next();
  });
  app.route('/api/v1/mining/marketplace', miningMarketplaceRouter);
  return app;
}

const TENANT = 'tnt-test';
const USER = 'usr-test';
const BID_ID = 'b1111111-2222-3333-4444-555555555555';
const BUYER_ID = 'a1111111-2222-3333-4444-555555555555';

// ---------------------------------------------------------------------------
// /mining/bids/incoming
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/bids/incoming', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('returns 401 without bearer', async () => {
    const app = mountBids(makeStubDb());
    const res = await app.request('/api/v1/mining/bids/incoming');
    expect(res.status).toBe(401);
  });

  it('returns 200 + filtered bids when authenticated', async () => {
    const db = makeStubDb({
      marketplace_bids: [
        {
          id: BID_ID,
          tenantId: TENANT,
          buyerId: BUYER_ID,
          listingId: 'lst-1',
          bidPriceTzs: '100000',
          status: 'pending',
          createdAt: new Date(),
        },
      ],
    });
    const app = mountBids(db);
    const res = await app.request('/api/v1/mining/bids/incoming', {
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// /mining/bids/mine
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/bids/mine', () => {
  it('returns 401 without bearer', async () => {
    const app = mountBids(makeStubDb());
    const res = await app.request('/api/v1/mining/bids/mine');
    expect(res.status).toBe(401);
  });

  it('returns 200 + empty when caller has no buyers row', async () => {
    const db = makeStubDb();
    const app = mountBids(db);
    const res = await app.request('/api/v1/mining/bids/mine', {
      headers: { Authorization: bearer(UserRole.PROPERTY_MANAGER) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(0);
  });

  it('returns 200 + caller bids when buyers row exists', async () => {
    const db = makeStubDb({
      buyers: [
        {
          id: BUYER_ID,
          tenantId: TENANT,
          linkedUserId: USER,
          kycStatus: 'verified',
        },
      ],
      marketplace_bids: [
        {
          id: BID_ID,
          tenantId: TENANT,
          buyerId: BUYER_ID,
          listingId: 'lst-1',
          bidPriceTzs: '100000',
          status: 'pending',
          createdAt: new Date(),
        },
      ],
    });
    const app = mountBids(db);
    const res = await app.request('/api/v1/mining/bids/mine', {
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /mining/bids/:id/withdraw
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/bids/:id/withdraw', () => {
  it('returns 401 without bearer', async () => {
    const app = mountBids(makeStubDb());
    const res = await app.request(
      `/api/v1/mining/bids/${BID_ID}/withdraw`,
      { method: 'POST' },
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when id is not a UUID', async () => {
    const app = mountBids(makeStubDb());
    const res = await app.request('/api/v1/mining/bids/not-a-uuid/withdraw', {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.PROPERTY_MANAGER) },
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 when caller has no buyers row', async () => {
    const app = mountBids(makeStubDb());
    const res = await app.request(
      `/api/v1/mining/bids/${BID_ID}/withdraw`,
      {
        method: 'POST',
        headers: { Authorization: bearer(UserRole.PROPERTY_MANAGER) },
      },
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 + withdraws when caller owns the bid', async () => {
    const db = makeStubDb({
      buyers: [
        {
          id: BUYER_ID,
          tenantId: TENANT,
          linkedUserId: USER,
          kycStatus: 'verified',
        },
      ],
      marketplace_bids: [
        {
          id: BID_ID,
          tenantId: TENANT,
          buyerId: BUYER_ID,
          listingId: 'lst-1',
          bidPriceTzs: '100000',
          status: 'pending',
          attributes: {},
        },
      ],
    });
    const app = mountBids(db);
    const res = await app.request(
      `/api/v1/mining/bids/${BID_ID}/withdraw`,
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.PROPERTY_MANAGER, {
            tenantId: TENANT,
            userId: USER,
          }),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Price too high' }),
      },
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// /mining/buyers/kyc/me
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/buyers/kyc/me', () => {
  it('returns 401 without bearer', async () => {
    const app = mountKyc(makeStubDb());
    const res = await app.request('/api/v1/mining/buyers/kyc/me');
    expect(res.status).toBe(401);
  });

  it('returns 404 when caller has no buyers row', async () => {
    const app = mountKyc(makeStubDb());
    const res = await app.request('/api/v1/mining/buyers/kyc/me', {
      headers: { Authorization: bearer(UserRole.PROPERTY_MANAGER) },
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 + buyer row when one exists', async () => {
    const db = makeStubDb({
      buyers: [
        {
          id: BUYER_ID,
          tenantId: TENANT,
          linkedUserId: USER,
          kycStatus: 'verified',
          kind: 'mineral_buyer',
          country: 'TZ',
          attributes: {},
          createdAt: new Date(),
        },
      ],
    });
    const app = mountKyc(db);
    const res = await app.request('/api/v1/mining/buyers/kyc/me', {
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { kycStatus: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.kycStatus).toBe('verified');
  });
});

// ---------------------------------------------------------------------------
// /mining/buyers/kyc/upload-atom
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/buyers/kyc/upload-atom', () => {
  it('returns 401 without bearer', async () => {
    const app = mountKyc(makeStubDb());
    const res = await app.request(
      '/api/v1/mining/buyers/kyc/upload-atom',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 's1',
          chunkIndex: 0,
          chunkBase64: 'AA==',
          isLast: true,
        }),
      },
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 on malformed body', async () => {
    const app = mountKyc(makeStubDb());
    const res = await app.request(
      '/api/v1/mining/buyers/kyc/upload-atom',
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.PROPERTY_MANAGER),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: '' }),
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when caller has no buyers row', async () => {
    const app = mountKyc(makeStubDb());
    const res = await app.request(
      '/api/v1/mining/buyers/kyc/upload-atom',
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.PROPERTY_MANAGER),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 's1',
          chunkIndex: 0,
          chunkBase64: 'AA==',
          isLast: false,
        }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('returns 201 + persists chunk when buyer exists', async () => {
    const db = makeStubDb({
      buyers: [
        {
          id: BUYER_ID,
          tenantId: TENANT,
          linkedUserId: USER,
          kycStatus: 'in_review',
          attributes: {},
        },
      ],
    });
    const app = mountKyc(db);
    const res = await app.request(
      '/api/v1/mining/buyers/kyc/upload-atom',
      {
        method: 'POST',
        headers: {
          Authorization: bearer(UserRole.PROPERTY_MANAGER, {
            tenantId: TENANT,
            userId: USER,
          }),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: 's1',
          chunkIndex: 0,
          chunkBase64: 'AAAA',
          isLast: true,
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { assembled: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.data.assembled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /mining/marketplace/market-intel
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/marketplace/market-intel', () => {
  it('returns 401 without bearer', async () => {
    const app = mountMarketplace(makeStubDb());
    const res = await app.request(
      '/api/v1/mining/marketplace/market-intel',
    );
    expect(res.status).toBe(401);
  });

  it('returns 200 + empty trend when no listings exist', async () => {
    const app = mountMarketplace(makeStubDb());
    const res = await app.request(
      '/api/v1/mining/marketplace/market-intel?commodity=gold',
      { headers: { Authorization: bearer(UserRole.PROPERTY_MANAGER) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { commodity: string; trend: unknown[] };
    };
    expect(body.success).toBe(true);
    expect(body.data.commodity).toBe('gold');
    expect(Array.isArray(body.data.trend)).toBe(true);
  });
});
