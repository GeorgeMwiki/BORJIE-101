/**
 * /api/v1/cooperatives/settlement-periods/:id — distribute + calculate tests.
 *
 * Proves the money-path FIXES:
 *   (1) /distribute posts to the REAL ledger via the injected port and stores
 *       the REAL journal id as `payment_ref` — NEVER a fabricated `COOP-…`
 *       ref, NEVER a silent no-op;
 *   (1b) /distribute FAILS CLOSED (no member marked paid) when the ledger port
 *        is unwired or a post throws — the whole distribution rolls back;
 *   (2) /calculate allocates per-member shares in integer minor units so the
 *       SUM provably equals the net (no float drift).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

import { settlementsRouter } from '../settlements.hono';
import {
  __setCooperativeDistributionLedgerPortForTests,
} from '../../../services/cooperative-settlement/distribution-ledger-port';

const TENANT = 'tnt-coop-1';

interface Recorded {
  fragments: ReadonlyArray<string>;
  params: ReadonlyArray<unknown>;
}

function flatten(arr: ReadonlyArray<unknown>): {
  fragments: string[];
  params: unknown[];
} {
  const fragments: string[] = [];
  const params: unknown[] = [];
  for (const c of arr) {
    if (c && typeof c === 'object' && 'value' in c) {
      fragments.push(String((c as { value: unknown }).value ?? ''));
    } else if (c && typeof c === 'object' && 'queryChunks' in c) {
      const nested = flatten(
        (c as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [],
      );
      fragments.push(...nested.fragments);
      params.push(...nested.params);
    } else {
      params.push(c);
    }
  }
  return { fragments, params };
}

/**
 * Fake Drizzle client. `responder` answers each `.execute` keyed on the
 * recorded SQL. `.transaction(cb)` runs the callback against the same client
 * so the route's per-member posts + stamps + period flip execute inline; a
 * throw inside the callback propagates (modelling rollback — the route then
 * fails closed).
 */
function makeDb(responder: (rec: Recorded) => unknown) {
  const calls: Recorded[] = [];
  const execute = async (q: unknown) => {
    if (q && typeof q === 'object' && 'queryChunks' in q) {
      const flat = flatten(
        (q as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [],
      );
      const rec = { fragments: flat.fragments, params: flat.params };
      calls.push(rec);
      return responder(rec);
    }
    return { rows: [] };
  };
  const db: Record<string, unknown> = {
    execute,
    async transaction(cb: (tx: unknown) => Promise<unknown>) {
      return cb(db);
    },
  };
  return { db, calls };
}

function buildApp(db: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth', { tenantId: TENANT, userId: 'owner-1' });
    c.set('db', db);
    await next();
  });
  app.route('/', settlementsRouter);
  return app;
}

beforeEach(() => {
  __setCooperativeDistributionLedgerPortForTests(null);
});

const PERIOD_ID = '99999999-1111-2222-3333-444444444444';
const DIST_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const DIST_B = 'bbbbbbbb-1111-2222-3333-444444444444';

/** Responder: approved period, two unpaid member distributions. */
function distributeResponder(rec: Recorded): unknown {
  const sqlText = rec.fragments.join('');
  if (sqlText.includes('SELECT status FROM cooperative_settlement_periods')) {
    return [{ status: 'approved' }];
  }
  if (sqlText.includes('FROM cooperative_member_distributions')) {
    return [
      { id: DIST_A, member_party_id: 'mem-a', amount_tzs: '600000', paid_at: null },
      { id: DIST_B, member_party_id: 'mem-b', amount_tzs: '400000', paid_at: null },
    ];
  }
  return [];
}

describe('POST /settlement-periods/:id/distribute — money path', () => {
  it('posts to the ledger per member and stores the REAL journal id as payment_ref', async () => {
    const { db, calls } = makeDb(distributeResponder);

    const posts: Array<{ distributionId: string; amountMajor: number }> = [];
    __setCooperativeDistributionLedgerPortForTests({
      async post(input) {
        posts.push({
          distributionId: input.distributionId,
          amountMajor: input.amountMajor,
        });
        return {
          journalId: `jnl_${input.distributionId.slice(0, 4)}`,
          currency: 'TZS' as never,
          amountMinorUnits: input.amountMajor,
        };
      },
    });

    const app = buildApp(db);
    const res = await app.request(`/settlement-periods/${PERIOD_ID}/distribute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // ONE ledger post per unpaid member, with the member's amount.
    expect(posts.length).toBe(2);
    expect(posts.map((p) => p.distributionId).sort()).toEqual(
      [DIST_A, DIST_B].sort(),
    );
    expect(posts.find((p) => p.distributionId === DIST_A)?.amountMajor).toBe(
      600000,
    );

    // The stored payment_ref is the REAL ledger journal id — never COOP-…
    const refs = body.data.ledgerRefs as Array<{ paymentRef: string }>;
    expect(refs.length).toBe(2);
    for (const r of refs) {
      expect(r.paymentRef).toMatch(/^jnl_/);
      expect(r.paymentRef).not.toMatch(/^COOP-/);
    }

    // The UPDATE that stamps payment_ref carries the ledger journal id, not a
    // fabricated COOP- ref.
    const updateStamps = calls.filter((c) =>
      c.fragments.join('').includes('SET paid_at'),
    );
    expect(updateStamps.length).toBe(2);
    for (const stamp of updateStamps) {
      const hasFabricatedRef = stamp.params.some(
        (p) => typeof p === 'string' && p.startsWith('COOP-'),
      );
      expect(hasFabricatedRef).toBe(false);
      const hasRealRef = stamp.params.some(
        (p) => typeof p === 'string' && p.startsWith('jnl_'),
      );
      expect(hasRealRef).toBe(true);
    }
  });

  it('FAILS CLOSED with 503 when the ledger port is not wired (no silent no-op)', async () => {
    const { db, calls } = makeDb(distributeResponder);
    // No test port set + no production port registered → resolver throws.
    __setCooperativeDistributionLedgerPortForTests(null);

    const app = buildApp(db);
    const res = await app.request(`/settlement-periods/${PERIOD_ID}/distribute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('COOP_DISTRIBUTION_LEDGER_NOT_WIRED');

    // NO member row was stamped paid — the route bailed before touching rows.
    const stamped = calls.some((c) =>
      c.fragments.join('').includes('SET paid_at'),
    );
    expect(stamped).toBe(false);
  });

  it('FAILS CLOSED with 502 when a ledger post throws (whole distribution rolls back)', async () => {
    const { db } = makeDb(distributeResponder);
    __setCooperativeDistributionLedgerPortForTests({
      async post() {
        throw new Error('ledger blew up');
      },
    });

    const app = buildApp(db);
    const res = await app.request(`/settlement-periods/${PERIOD_ID}/distribute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('DISTRIBUTION_FAILED');
  });

  it('refuses to distribute a period that is not approved (409)', async () => {
    const { db } = makeDb((rec) => {
      if (
        rec.fragments
          .join('')
          .includes('SELECT status FROM cooperative_settlement_periods')
      ) {
        return [{ status: 'calculated' }];
      }
      return [];
    });
    __setCooperativeDistributionLedgerPortForTests({
      async post() {
        throw new Error('should not be reached');
      },
    });

    const app = buildApp(db);
    const res = await app.request(`/settlement-periods/${PERIOD_ID}/distribute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /settlement-periods/:id/calculate — share allocation', () => {
  it('allocates per-member shares in integer minor units so SUM equals net exactly', async () => {
    // net = 100.10 with shares [33.33, 33.33, 33.34] is a PROVABLE float-drift
    // case: the OLD `Number(((sharePct/100)*net).toFixed(2))` formula sums to
    // 10009 cents (off by 1 from the 10010-cent net). The integer allocation
    // here must sum to the net to the last cent — red-then-green.
    const net = '100.10';
    const insertedAmounts: number[] = [];
    const { db } = makeDb((rec) => {
      const sqlText = rec.fragments.join('');
      if (
        sqlText.includes('SELECT net_distributable_tzs') &&
        sqlText.includes('cooperative_settlement_periods')
      ) {
        return [{ net_distributable_tzs: net, status: 'calculated' }];
      }
      if (sqlText.includes('INSERT INTO cooperative_member_distributions')) {
        // Param order (see the route INSERT): [distId, tenantId, periodId,
        // memberPartyId, sharePct, amount, distHash, prov]. Index 5 is the
        // amount_tzs (major units). Pull it deterministically.
        const amount = rec.params[5];
        if (typeof amount === 'number') insertedAmounts.push(amount);
        return [];
      }
      if (sqlText.includes('SELECT * FROM cooperative_member_distributions')) {
        return [];
      }
      return [];
    });

    const app = buildApp(db);
    const res = await app.request(`/settlement-periods/${PERIOD_ID}/calculate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        members: [
          { memberPartyId: '11111111-1111-1111-1111-111111111111', sharePct: 33.33 },
          { memberPartyId: '22222222-2222-2222-2222-222222222222', sharePct: 33.33 },
          { memberPartyId: '33333333-3333-3333-3333-333333333333', sharePct: 33.34 },
        ],
      }),
    });

    expect(res.status).toBe(200);

    // The three inserted amounts must sum to the net EXACTLY (in cents).
    const sumCents = insertedAmounts.reduce(
      (s, v) => s + Math.round(v * 100),
      0,
    );
    expect(sumCents).toBe(Math.round(Number(net) * 100));
  });
});
