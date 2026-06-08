/**
 * Buyer blocked-flow routes — smoke tests.
 *
 * Coverage for the endpoints that unblocked three buyer-mobile flows:
 *
 *   - GET   /mining/bids/:id          buyer fetches ONE of their own bids
 *   - PATCH /mining/buyers/profile    buyer updates their own profile
 *
 * Both routes resolve the buyer via `buyers.linked_user_id` and never
 * leak existence across buyer / tenant boundaries (CLAUDE.md belt-and-
 * braces predicate on top of RLS). A tiny fake Drizzle client satisfies
 * the handlers' shape requirements — including the `innerJoin` the bid
 * detail route needs to surface the listing summary.
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
import { generateToken } from '../../../middleware/auth.js';
import { UserRole } from '../../../types/user-role.js';

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Minimal stub db — supports select/innerJoin/where + update/returning.
//
// `innerJoin` is a no-op for filtering (the seeded rows already carry the
// joined shape under `bid` / `listing` keys); the projection the handler
// passes to `.select({...})` is ignored and the seeded row is returned
// verbatim. That is enough to exercise the predicate + envelope path.
// ---------------------------------------------------------------------------

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
  function isPrimitive(v: unknown): v is string | number | boolean {
    return (
      typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
    );
  }

  // Parse a drizzle `SQL` node (the shape `eq()` / `and()` produce). A real
  // `eq(column, value)` materialises its `queryChunks` as:
  //   [StringChunk{value:['']}, Column{name,…}, StringChunk{value:[' = ']},
  //    Param{brand:'Param', value}, StringChunk{value:['']}]
  // The column is the chunk with a string `.name`; the bound value is the
  // `Param` chunk (object with a primitive `.value`) — or, in the trivial
  // `{name}`-column probe shape, a bare primitive chunk. StringChunk
  // wrappers carry `.value` as an ARRAY, so we exclude those. `and()` nests
  // its operand SQL nodes as chunks, so we recurse into any with their own
  // `queryChunks`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function evalSql(row: Row, node: any): boolean {
    const chunks: unknown[] = Array.isArray(node?.queryChunks)
      ? node.queryChunks
      : [];
    if (chunks.length === 0) return true;
    // Nested SQL operands (e.g. the two eq() inside an and()): recurse.
    const nested = chunks.filter(
      (c) => c && typeof c === 'object' && Array.isArray((c as any).queryChunks),
    );
    if (nested.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return nested.every((n: any) => evalSql(row, n));
    }
    // Leaf eq(): find the column name + the bound primitive value.
    let colName: string | undefined;
    let value: unknown;
    let valueFound = false;
    let sawColumn = false;
    for (const chunk of chunks) {
      // Column chunk: object with a string `.name`.
      if (
        chunk &&
        typeof chunk === 'object' &&
        typeof (chunk as { name?: unknown }).name === 'string'
      ) {
        colName = (chunk as { name: string }).name;
        sawColumn = true;
        continue;
      }
      if (!sawColumn || valueFound) continue;
      // Bare primitive value (trivial probe shape).
      if (isPrimitive(chunk)) {
        value = chunk;
        valueFound = true;
        continue;
      }
      // Param chunk: object with a non-array primitive `.value`.
      if (chunk && typeof chunk === 'object' && 'value' in (chunk as object)) {
        const v = (chunk as { value: unknown }).value;
        if (!Array.isArray(v) && isPrimitive(v)) {
          value = v;
          valueFound = true;
        }
      }
    }
    if (!colName) return true;
    const candidate = row[colName] ?? row[snakeToCamel(colName)];
    return candidate === value;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function rowMatches(row: Row, cond: any): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => rowMatches(row, c));
    if (cond?.queries && Array.isArray(cond.queries)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return cond.queries.every((q: any) => rowMatches(row, q));
    }
    if (Array.isArray(cond?.queryChunks)) {
      return evalSql(row, cond);
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
        innerJoin() {
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

const TENANT = 'tnt-test';
const USER = 'usr-test';
const BID_ID = 'b1111111-2222-3333-4444-555555555555';
const BUYER_ID = 'a1111111-2222-3333-4444-555555555555';

// ---------------------------------------------------------------------------
// GET /mining/bids/:id
// ---------------------------------------------------------------------------

describe('GET /api/v1/mining/bids/:id', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('returns 401 without bearer', async () => {
    const app = mountBids(makeStubDb());
    const res = await app.request(`/api/v1/mining/bids/${BID_ID}`);
    expect(res.status).toBe(401);
  });

  it('returns 400 when id is not a UUID', async () => {
    const app = mountBids(makeStubDb());
    const res = await app.request('/api/v1/mining/bids/not-a-uuid', {
      headers: { Authorization: bearer(UserRole.PROPERTY_MANAGER) },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when caller has no buyers row', async () => {
    const app = mountBids(makeStubDb());
    const res = await app.request(`/api/v1/mining/bids/${BID_ID}`, {
      headers: { Authorization: bearer(UserRole.PROPERTY_MANAGER) },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the bid belongs to another buyer', async () => {
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
          bid: { id: BID_ID },
          id: BID_ID,
          tenantId: TENANT,
          buyerId: 'someone-else',
          listingId: 'lst-1',
          bidPriceTzs: '100000',
          status: 'pending',
          createdAt: new Date(),
        },
      ],
    });
    const app = mountBids(db);
    const res = await app.request(`/api/v1/mining/bids/${BID_ID}`, {
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
      },
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 + the bid when the caller owns it', async () => {
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
          // seeded row already carries the joined shape under `bid`
          bid: {
            id: BID_ID,
            listingId: 'lst-1',
            bidPriceTzs: '100000',
            status: 'pending',
          },
          listing: { id: 'lst-1', title: 'Gold dore parcel' },
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
    const res = await app.request(`/api/v1/mining/bids/${BID_ID}`, {
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row };
    expect(body.success).toBe(true);
    expect(body.data).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PATCH /mining/buyers/profile
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/mining/buyers/profile', () => {
  it('returns 401 without bearer', async () => {
    const app = mountKyc(makeStubDb());
    const res = await app.request('/api/v1/mining/buyers/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName: 'Acme' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on empty patch body', async () => {
    const app = mountKyc(makeStubDb());
    const res = await app.request('/api/v1/mining/buyers/profile', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when caller has no buyers row', async () => {
    const app = mountKyc(makeStubDb());
    const res = await app.request('/api/v1/mining/buyers/profile', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ companyName: 'Acme' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 + BuyerUser envelope when caller owns a buyers row', async () => {
    const db = makeStubDb({
      buyers: [
        {
          id: BUYER_ID,
          tenantId: TENANT,
          linkedUserId: USER,
          name: 'Old Name',
          country: 'TZ',
          kycStatus: 'verified',
          contactPhone: '+255700000000',
          attributes: {},
        },
      ],
    });
    const app = mountKyc(db);
    const res = await app.request('/api/v1/mining/buyers/profile', {
      method: 'PATCH',
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          tenantId: TENANT,
          userId: USER,
        }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        companyName: 'New Name',
        phone: '+255711111111',
        preferredLang: 'en',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { companyName: string; preferredLang: string; phone: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.companyName).toBe('New Name');
    expect(body.data.preferredLang).toBe('en');
    expect(body.data.phone).toBe('+255711111111');
  });
});
