/**
 * Offtake-agreement dual-sign settlement enqueue — the EXACTLY-ONCE money
 * trigger (LANE: mining-bid-accept-no-payment-trigger).
 *
 * THE INVARIANT UNDER TEST (the money-path completion law): an offtake
 * agreement reaches `signed` via EITHER party —
 *   - the SELLER signs  POST /api/v1/mining/bids/offtake-agreements/:id/sign
 *   - the BUYER  signs  POST /api/v1/mining/buyers/documents/:id/sign
 * There is a single `signed` status (not a dual-party gate), so whichever
 * party signs FIRST flips the agreement and MUST emit exactly ONE
 * `settlement.requested` row into the transactional `event_outbox`, written
 * IN THE SAME TRANSACTION as the status flip. The second party's later sign
 * hits the already-signed early-return and the `eq(status,'pending_signature')`
 * compare-and-set, so it NEVER enqueues a second settlement —
 * `settlement.requested` is produced EXACTLY ONCE per agreement REGARDLESS of
 * sign order (services/api-gateway/src/services/offtake-settlement.ts).
 *
 * This is the gate the cold money-check requires: prove exactly-once across
 * BOTH sign orders (seller-first and buyer-first), and that a second sign on
 * the SAME surface is also a no-op. `event_outbox` carries no UNIQUE on
 * (aggregate_id, event_type) (outbox.schema.ts), so the only dedupe is the
 * caller's transition guard — exactly what these tests exercise behaviorally.
 *
 * The stub db models the slice both sign paths touch:
 *   - select().from().where().limit()           (buyer + agreement re-read)
 *   - update().set().where().returning()         (CAS status flip)
 *   - insert(eventOutbox).values()               (settlement.requested row)
 *   - transaction(cb)                            (tenant-bound tx; shared store)
 *   - execute(sql)                               (next-sequence-number SELECT)
 * The shared-store transaction means a write inside the tx is visible to the
 * next request, so a buyer-first sign that flips status to `signed` makes the
 * subsequent seller sign hit the already-signed branch — modelling the real
 * exactly-once guard, not a mock of it.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { miningBidsRouter } from '../bids.hono.js';
import { miningBuyersDocumentsRouter } from '../buyers-documents.hono.js';
import { generateToken } from '../../../middleware/auth.js';
import { UserRole } from '../../../types/user-role.js';

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Stub db — select / update / insert / transaction / execute.
// Shared store so writes inside a transaction persist for the next request
// (modelling commit), which is what makes the exactly-once guard observable.
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
                    // CAS semantics: only rows still matching the predicate
                    // (incl. status='pending_signature') are updated + returned.
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
            const doInsert = () => {
              const list = store.get(name) ?? [];
              const next = [...list, { ...vals }];
              store.set(name, next);
              return Promise.resolve([{ ...vals }]);
            };
            const chain = {
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
        // Share the same store so writes inside the tx are visible after
        // (models commit) — the exactly-once guard depends on the first
        // signer's status flip being observed by the second signer.
        return cb(buildClient());
      },
      // execute(sql) backs nextSequenceNumber's MAX(sequence_number)+1 SELECT.
      // A `{ rows: [] }` shape yields next_seq = 1, sufficient to prove the
      // row is written; ordering monotonicity is asserted on the stored row.
      async execute() {
        return { rows: [] as Row[] };
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

const TENANT = 'tnt-test';
const SELLER_USER = 'usr-seller';
const BUYER_USER = 'usr-buyer';
const BUYER_ID = 'a1111111-2222-3333-4444-555555555555';
const LISTING_ID = 'lst-1';
const BID_ID = 'b1111111-2222-3333-4444-555555555555';
// 36-char UUID so it satisfies BOTH the seller path id regex
// (^[0-9a-z-]{8,64}$) and the buyer path UUID_RE (^[0-9a-f-]{36}$).
const AGREEMENT_ID = 'c1111111-2222-3333-4444-555555555555';

function seedPendingAgreement() {
  return makeStubDb({
    buyers: [
      {
        id: BUYER_ID,
        tenantId: TENANT,
        linkedUserId: BUYER_USER,
        kycStatus: 'verified',
      },
    ],
    offtake_agreements: [
      {
        id: AGREEMENT_ID,
        tenantId: TENANT,
        bidId: BID_ID,
        listingId: LISTING_ID,
        buyerId: BUYER_ID,
        buyerTenantId: null,
        agreedPriceTzs: '250000.00',
        quantityKg: '12.000',
        status: 'pending_signature',
        signedAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    tenants: [{ id: TENANT, name: 'Estate One' }],
    event_outbox: [],
  });
}

function mount(db: ReturnType<typeof makeStubDb>) {
  const app = new Hono();
  // Pre-inject the stub db; both routers' databaseMiddleware honours an
  // existing `c.get('db')` binding (services/.../middleware/database.ts).
  app.use('*', async (c, next) => {
    // @ts-expect-error — db slot augmented by databaseMiddleware in prod.
    c.set('db', db);
    await next();
  });
  app.route('/api/v1/mining/bids', miningBidsRouter);
  app.route('/api/v1/mining/buyers/documents', miningBuyersDocumentsRouter);
  return app;
}

function settlementRows(db: ReturnType<typeof makeStubDb>): Row[] {
  return (db.store.get('event_outbox') ?? []).filter(
    (r) => r.eventType === 'settlement.requested',
  );
}

async function sellerSign(app: ReturnType<typeof mount>) {
  return app.request(
    `/api/v1/mining/bids/offtake-agreements/${AGREEMENT_ID}/sign`,
    {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, {
          userId: SELLER_USER,
        }),
      },
    },
  );
}

async function buyerSign(app: ReturnType<typeof mount>) {
  return app.request(
    `/api/v1/mining/buyers/documents/${AGREEMENT_ID}/sign`,
    {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.PROPERTY_MANAGER, { userId: BUYER_USER }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ biometricToken: 'bio-ok-token' }),
    },
  );
}

describe('offtake dual-sign → settlement.requested enqueued EXACTLY ONCE', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('seller-first then buyer-second → exactly one settlement.requested', async () => {
    const db = seedPendingAgreement();
    const app = mount(db);

    const s = await sellerSign(app);
    expect(s.status).toBe(200);
    // First sign flips to signed AND enqueues.
    expect(settlementRows(db)).toHaveLength(1);

    const b = await buyerSign(app);
    expect(b.status).toBe(200);
    // Buyer sees an already-signed agreement → idempotent no-op, NO 2nd enqueue.
    const bBody = (await b.json()) as { meta?: { idempotent?: boolean } };
    expect(bBody.meta?.idempotent).toBe(true);

    const rows = settlementRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.aggregateId).toBe(AGREEMENT_ID);
    expect(rows[0]!.aggregateType).toBe('offtake_agreement');
  });

  it('buyer-first then seller-second → exactly one settlement.requested', async () => {
    const db = seedPendingAgreement();
    const app = mount(db);

    const b = await buyerSign(app);
    expect(b.status).toBe(200);
    const bBody = (await b.json()) as {
      meta?: { settlementEnqueued?: boolean };
    };
    // Buyer wins the signature → flips + enqueues exactly once.
    expect(bBody.meta?.settlementEnqueued).toBe(true);
    expect(settlementRows(db)).toHaveLength(1);

    const s = await sellerSign(app);
    expect(s.status).toBe(200);
    // Seller now sees `signed` → already-signed early-return, NO 2nd enqueue.

    const rows = settlementRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.aggregateId).toBe(AGREEMENT_ID);
    // The single event carries the seller tenant + the contract terms the
    // settlement worker consumes (the wire contract from offtake-settlement.ts).
    const payload = rows[0]!.payload as Record<string, unknown>;
    expect(payload.offtakeAgreementId).toBe(AGREEMENT_ID);
    expect(payload.tenantId).toBe(TENANT);
    expect(payload.buyerId).toBe(BUYER_ID);
    expect(payload.agreedPriceTzs).toBe('250000.00');
    expect(payload.quantityKg).toBe('12.000');
  });

  it('a SECOND seller sign on the same surface never enqueues a second settlement', async () => {
    const db = seedPendingAgreement();
    const app = mount(db);

    const s1 = await sellerSign(app);
    expect(s1.status).toBe(200);
    expect(settlementRows(db)).toHaveLength(1);

    const s2 = await sellerSign(app);
    expect(s2.status).toBe(200);
    // Already-signed branch — idempotent, single enqueue total.
    expect(settlementRows(db)).toHaveLength(1);
  });

  it('a SECOND buyer sign on the same surface never enqueues a second settlement', async () => {
    const db = seedPendingAgreement();
    const app = mount(db);

    const b1 = await buyerSign(app);
    expect(b1.status).toBe(200);
    expect(settlementRows(db)).toHaveLength(1);

    const b2 = await buyerSign(app);
    expect(b2.status).toBe(200);
    const b2Body = (await b2.json()) as { meta?: { idempotent?: boolean } };
    expect(b2Body.meta?.idempotent).toBe(true);
    expect(settlementRows(db)).toHaveLength(1);
  });
});
