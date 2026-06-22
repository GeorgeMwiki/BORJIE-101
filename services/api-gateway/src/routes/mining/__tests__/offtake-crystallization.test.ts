/**
 * Offtake-agreement crystallization on bid accept (LANE B3).
 *
 * Proves the MARKETPLACE launch-blocker closure: accepting a marketplace
 * bid now crystallizes EXACTLY ONE binding `offtake_agreements` row, and
 * the crystallization is IDEMPOTENT on `bid_id` (re-accepting the same bid
 * never creates a second contract). Also proves the tenant-scoped read
 * endpoints surface the crystallized contract to seller and buyer.
 *
 * The stub db below models the slice of Drizzle the accept path touches:
 *   - select().from().where().limit()           (bid + listing re-read)
 *   - update().set().where().returning()         (status flip)
 *   - insert().values().onConflictDoNothing()    (idempotent contract)
 *   - transaction(cb)                            (tenant-bound tx)
 * `onConflictDoNothing({ target })` is honored against a per-table unique
 * key set so the second accept is a true no-op — exactly the production
 * UNIQUE(bid_id) semantics from migration 0325.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { miningBidsRouter } from '../bids.hono.js';
import { generateToken } from '../../../middleware/auth.js';
import { UserRole } from '../../../types/user-role.js';

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Stub db — select / update / insert(onConflictDoNothing) / transaction.
// ---------------------------------------------------------------------------

function makeStubDb(seed: Record<string, Row[]> = {}) {
  const store = new Map<string, Row[]>();
  for (const [k, v] of Object.entries(seed)) store.set(k, [...v]);

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function evalSql(row: Row, node: any): boolean {
    const chunks: unknown[] = Array.isArray(node?.queryChunks)
      ? node.queryChunks
      : [];
    if (chunks.length === 0) return true;
    const nested = chunks.filter(
      (c) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        c && typeof c === 'object' && Array.isArray((c as any).queryChunks),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (nested.length > 0) return nested.every((n: any) => evalSql(row, n));
    let colName: string | undefined;
    let value: unknown;
    let valueFound = false;
    let sawColumn = false;
    for (const chunk of chunks) {
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
      if (isPrimitive(chunk)) {
        value = chunk;
        valueFound = true;
        continue;
      }
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
    if (Array.isArray(cond?.queryChunks)) return evalSql(row, cond);
    return true;
  }

  function buildClient() {
    const client = {
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
                      if (rowMatches(list[i]!, cond)) {
                        list[i] = { ...list[i]!, ...changes };
                      }
                    }
                    store.set(name, list);
                    return matched.map((m) => ({ ...m, ...changes }));
                  },
                };
              },
            };
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert(table: any) {
        const name = tableName(table);
        return {
          values(vals: Row) {
            const doInsert = (conflictCol?: string) => {
              const list = store.get(name) ?? [];
              if (conflictCol) {
                const exists = list.some(
                  (r) => r[conflictCol] === vals[conflictCol],
                );
                if (exists) {
                  store.set(name, list);
                  return Promise.resolve([] as Row[]);
                }
              }
              const next = [...list, { ...vals }];
              store.set(name, next);
              return Promise.resolve([{ ...vals }]);
            };
            const chain = {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onConflictDoNothing(arg?: any) {
                // target is a Drizzle column → derive its snake/camel name.
                const target = arg?.target;
                let col: string | undefined;
                if (target && typeof target === 'object' && 'name' in target) {
                  col = (target as { name: string }).name;
                  col = snakeToCamel(col);
                }
                // Production chains `.onConflictDoNothing(...).returning(...)`
                // (crystallizeOfftakeAgreement), so this must stay chainable —
                // returning a bare Promise here made `.returning` undefined and
                // threw, surfacing as a 500. Run the insert ONCE (memoised) and
                // expose both `.returning()` and an awaitable `then`.
                let cached: Promise<Row[]> | undefined;
                const run = () => (cached ??= doInsert(col));
                return {
                  async returning() {
                    return run();
                  },
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  then(resolve: any) {
                    resolve(run());
                  },
                };
              },
              async returning() {
                return doInsert();
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              then(resolve: any) {
                resolve(doInsert());
              },
            };
            return chain;
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async transaction(cb: (tx: any) => Promise<unknown>) {
        // Share the same store so writes inside the tx are visible after.
        return cb(buildClient());
      },
      async execute() {
        return { rows: [] };
      },
    };
    return client;
  }

  return buildClient();
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

function mount(db: ReturnType<typeof makeStubDb>) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    // @ts-expect-error — db slot augmented by databaseMiddleware in prod.
    c.set('db', db);
    await next();
  });
  app.route('/api/v1/mining/bids', miningBidsRouter);
  return app;
}

const TENANT = 'tnt-test';
const USER = 'usr-test';
const BID_ID = 'b1111111-2222-3333-4444-555555555555';
const BUYER_ID = 'a1111111-2222-3333-4444-555555555555';
const LISTING_ID = 'lst-1';

function seedDb() {
  return makeStubDb({
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
        listingId: LISTING_ID,
        bidPriceTzs: '250000.00',
        paymentTerms: 'net_30',
        status: 'pending',
        attributes: {},
        acceptedAt: null,
        createdAt: new Date(),
      },
    ],
    marketplace_listings: [
      {
        id: LISTING_ID,
        tenantId: TENANT,
        title: 'Gold doré 12kg',
        category: 'mineral',
        priceTzs: '250000.00',
        attributes: { quantity_kg: 12 },
        createdAt: new Date(),
      },
    ],
    offtake_agreements: [],
  });
}

describe('POST /api/v1/mining/bids/:id/accept — crystallizes offtake agreement', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('flips the bid to accepted AND creates exactly one offtake_agreements row', async () => {
    const db = seedDb();
    const app = mount(db);
    const res = await app.request(`/api/v1/mining/bids/${BID_ID}/accept`, {
      method: 'POST',
      headers: { Authorization: bearer(UserRole.PROPERTY_MANAGER) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('accepted');

    const agreements = db.store.get('offtake_agreements') ?? [];
    expect(agreements).toHaveLength(1);
    const a = agreements[0]!;
    expect(a.bidId).toBe(BID_ID);
    expect(a.tenantId).toBe(TENANT);
    expect(a.listingId).toBe(LISTING_ID);
    expect(a.buyerId).toBe(BUYER_ID);
    // CONTRACT TERMS carried from the bid + listing.
    expect(a.agreedPriceTzs).toBe('250000.00');
    expect(a.quantityKg).toBe('12.000');
    expect(a.status).toBe('pending_signature');
  });

  it('is IDEMPOTENT — re-accepting the same bid never creates a second row', async () => {
    const db = seedDb();
    const app = mount(db);
    const headers = { Authorization: bearer(UserRole.PROPERTY_MANAGER) };

    const r1 = await app.request(`/api/v1/mining/bids/${BID_ID}/accept`, {
      method: 'POST',
      headers,
    });
    expect(r1.status).toBe(200);
    const r2 = await app.request(`/api/v1/mining/bids/${BID_ID}/accept`, {
      method: 'POST',
      headers,
    });
    expect(r2.status).toBe(200);

    const agreements = db.store.get('offtake_agreements') ?? [];
    expect(agreements).toHaveLength(1);
  });

  it('seller read surfaces the crystallized agreement (tenant-scoped)', async () => {
    const db = seedDb();
    const app = mount(db);
    const headers = { Authorization: bearer(UserRole.PROPERTY_MANAGER) };
    await app.request(`/api/v1/mining/bids/${BID_ID}/accept`, {
      method: 'POST',
      headers,
    });
    const res = await app.request(
      '/api/v1/mining/bids/offtake-agreements',
      { headers },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.bidId).toBe(BID_ID);
  });

  it('buyer read surfaces only the calling buyer’s agreements', async () => {
    const db = seedDb();
    const app = mount(db);
    const headers = { Authorization: bearer(UserRole.PROPERTY_MANAGER) };
    await app.request(`/api/v1/mining/bids/${BID_ID}/accept`, {
      method: 'POST',
      headers,
    });
    const res = await app.request(
      '/api/v1/mining/bids/offtake-agreements/mine',
      { headers },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Row[] };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.buyerId).toBe(BUYER_ID);
  });

  it('returns 404 when the bid does not exist', async () => {
    const db = makeStubDb({ offtake_agreements: [] });
    const app = mount(db);
    const res = await app.request(
      `/api/v1/mining/bids/c2222222-3333-4444-5555-666666666666/accept`,
      {
        method: 'POST',
        headers: { Authorization: bearer(UserRole.PROPERTY_MANAGER) },
      },
    );
    expect(res.status).toBe(404);
    const agreements = db.store.get('offtake_agreements') ?? [];
    expect(agreements).toHaveLength(0);
  });
});
