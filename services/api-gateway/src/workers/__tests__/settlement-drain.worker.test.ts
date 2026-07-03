/**
 * settlement-drain worker tests (mining-bid-accept-no-payment-trigger closeout).
 *
 * THE INVARIANT UNDER TEST (the money-leg completion law): a signed offtake
 * agreement enqueues a `settlement.requested` outbox event; this worker is
 * the consumer that turns it into a BALANCED double-entry ledger post via the
 * shared SettlementLedgerPort (LedgerService.post()). Before this worker the
 * event was born-dark — nothing drained it, so the seller settlement never
 * posted.
 *
 * The worker takes a bare `{ execute(q) }` db (no `.transaction`), so the
 * RLS wrappers (withServiceRoleContext / withTenantContext) execute the
 * callback directly against the stub — the stub enforces no RLS, exactly as
 * production unit tests do. We drive `execute` with a scripted list of
 * responses mimicking the SELECT (pick) / UPDATE...RETURNING (CAS claim) /
 * SELECT (mineral) / UPDATE (published) queries, and inject a stub ledger
 * port to prove the money leg fires with the correct balanced math.
 *
 * Coverage:
 *   - happy path: pick → claim → ledger.post() → published; correct
 *     gross/royalty/fee/net; idempotencyKey anchored to the agreement id.
 *   - idempotent redelivery: once a row is `published` the pick returns it no
 *     more, so a re-tick posts NOTHING (no second ledger post, no double-pay).
 *   - CAS contention: a row already claimed by another worker is skipped, the
 *     ledger is never touched.
 *   - ledger failure: the row is marked for retry (retry_count bumped,
 *     next_retry_at set), never published.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createSettlementDrainWorker,
  computeOfftakeSettlementMath,
} from '../settlement-drain.worker.js';
import type { SettlementLedgerPort } from '../../services/settlement/index.js';

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function captureSqlText(q: unknown): string {
  if (q && typeof q === 'object') {
    const queryChunks = (q as { queryChunks?: unknown }).queryChunks;
    if (Array.isArray(queryChunks)) {
      return queryChunks
        .map((c) => {
          if (c == null) return '';
          if (typeof c === 'string') return c;
          if (typeof c === 'object') {
            const obj = c as Record<string, unknown>;
            if (typeof obj.value !== 'undefined') {
              const v = obj.value;
              if (v == null) return '';
              if (typeof v === 'object') return JSON.stringify(v);
              return String(v);
            }
            return '';
          }
          return String(c);
        })
        .join(' ');
    }
  }
  try {
    return JSON.stringify(q);
  } catch {
    return String(q);
  }
}

/**
 * A db whose `execute` answers a programmable script of responses keyed by
 * call index. No `.transaction` member → the RLS wrappers run the callback
 * directly. Captures the raw queries for SQL-shape assertions.
 */
function makeScriptedDb(script: ReadonlyArray<unknown>) {
  const calls: { sql: string }[] = [];
  let i = 0;
  const execute = vi.fn(async (q: unknown) => {
    calls.push({ sql: captureSqlText(q) });
    const v = script[i];
    i += 1;
    if (v instanceof Error) throw v;
    return v ?? [];
  });
  return { db: { execute }, execute, calls };
}

function stubLedgerPort(): {
  port: SettlementLedgerPort;
  post: ReturnType<typeof vi.fn>;
} {
  const post = vi.fn(async () => ({ journalId: 'jrn_offtake_1' }));
  return { port: { post } as unknown as SettlementLedgerPort, post };
}

const PAYLOAD = {
  offtakeAgreementId: 'agr-1',
  bidId: 'bid-1',
  listingId: 'lst-1',
  buyerId: 'buy-1',
  buyerTenantId: null,
  agreedPriceTzs: '1000000.00', // TOTAL gross
  quantityKg: '12.000',
  tenantId: 'tenant-A',
  signedBy: 'usr-seller',
};

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    tenant_id: 'tenant-A',
    aggregate_id: 'agr-1',
    payload: PAYLOAD,
    retry_count: 0,
    max_retries: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// pure math
// ---------------------------------------------------------------------------

describe('computeOfftakeSettlementMath', () => {
  it('treats agreedPriceTzs as TOTAL gross and balances gross = royalty+fee+net', () => {
    const math = computeOfftakeSettlementMath({
      agreedPriceTzs: '1000000',
      mineralKind: 'gold', // 7% royalty
    });
    expect(math.grossTzs).toBe(1_000_000);
    expect(math.royaltyTzs).toBe(70_000); // 7%
    expect(math.feeTzs).toBe(15_000); // 1.5%
    expect(math.netTzs).toBe(915_000); // exact remainder
    // Double-entry identity.
    expect(math.royaltyTzs + math.feeTzs + math.netTzs).toBe(math.grossTzs);
  });

  it('falls back to the default royalty rate for an unknown mineral', () => {
    const math = computeOfftakeSettlementMath({
      agreedPriceTzs: '1000000',
      mineralKind: 'unobtanium',
    });
    // default rate 7% → same identity must still hold.
    expect(math.royaltyTzs + math.feeTzs + math.netTzs).toBe(math.grossTzs);
    expect(math.grossTzs).toBe(1_000_000);
  });

  it('rejects a non-positive gross', () => {
    expect(() =>
      computeOfftakeSettlementMath({ agreedPriceTzs: '0', mineralKind: 'gold' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// tickOnce — happy path
// ---------------------------------------------------------------------------

describe('createSettlementDrainWorker.tickOnce — posts the ledger', () => {
  it('picks, claims, posts a balanced journal, and marks published', async () => {
    const { db, calls } = makeScriptedDb([
      [], // reclaimStale UPDATE (no stale rows)
      [pendingRow()], // pickPending SELECT
      [{ id: 'evt_1' }], // claim CAS UPDATE ... RETURNING
      [{ mineral: 'gold_concentrate', category: 'mineral' }], // resolveMineralKind SELECT
      [], // markPublished UPDATE
    ]);
    const { port, post } = stubLedgerPort();
    const worker = createSettlementDrainWorker({
      db,
      logger: noopLogger,
      resolveLedgerPort: () => port,
    });

    const result = await worker.tickOnce();

    expect(result).toEqual({ claimed: 1, posted: 1, failed: 0, reclaimed: 0 });
    // Money leg fired exactly once through the shared SettlementLedgerPort.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-A',
        responseId: 'agr-1',
        idempotencyKey: 'offtake:agr-1',
        math: expect.objectContaining({
          grossTzs: 1_000_000,
          royaltyTzs: 70_000, // gold_concentrate → gold → 7%
          feeTzs: 15_000,
          netTzs: 915_000,
        }),
      }),
    );
    // Final UPDATE flips the outbox row to 'published'.
    expect(calls[calls.length - 1]!.sql).toContain('published');
  });
});

// ---------------------------------------------------------------------------
// idempotency on redelivery
// ---------------------------------------------------------------------------

describe('createSettlementDrainWorker — idempotent on redelivery', () => {
  it('a re-tick after publish picks NOTHING → no second ledger post', async () => {
    const { db } = makeScriptedDb([
      [], // tick 1: reclaimStale (none)
      [pendingRow()], // tick 1: pick
      [{ id: 'evt_1' }], // tick 1: claim
      [{ mineral: 'gold' }], // tick 1: mineral
      [], // tick 1: published
      [], // tick 2: reclaimStale (none)
      [], // tick 2: pick returns EMPTY (row now published, not re-picked)
    ]);
    const { port, post } = stubLedgerPort();
    const worker = createSettlementDrainWorker({
      db,
      logger: noopLogger,
      resolveLedgerPort: () => port,
    });

    const first = await worker.tickOnce();
    expect(first).toEqual({ claimed: 1, posted: 1, failed: 0, reclaimed: 0 });

    const second = await worker.tickOnce();
    // A redelivered/at-least-once event is not re-picked once published →
    // the ledger is NOT posted a second time (no double-pay).
    expect(second).toEqual({ claimed: 0, posted: 0, failed: 0, reclaimed: 0 });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('skips a row already claimed by another worker (CAS lost) — ledger untouched', async () => {
    const { db } = makeScriptedDb([
      [], // reclaimStale (none)
      [pendingRow()], // pick
      [], // claim CAS returns NO row (another worker won)
    ]);
    const { port, post } = stubLedgerPort();
    const worker = createSettlementDrainWorker({
      db,
      logger: noopLogger,
      resolveLedgerPort: () => port,
    });

    const result = await worker.tickOnce();
    expect(result).toEqual({ claimed: 0, posted: 0, failed: 0, reclaimed: 0 });
    expect(post).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// failure → retry
// ---------------------------------------------------------------------------

describe('createSettlementDrainWorker — ledger failure retries', () => {
  it('marks the row for retry (never published) when the ledger post throws', async () => {
    const { db, calls } = makeScriptedDb([
      [], // reclaimStale (none)
      [pendingRow()], // pick
      [{ id: 'evt_1' }], // claim
      [{ mineral: 'gold' }], // mineral
      [], // markFailureRetry UPDATE
    ]);
    const post = vi.fn(async () => {
      throw new Error('LEDGER_NOT_WIRED');
    });
    const worker = createSettlementDrainWorker({
      db,
      logger: noopLogger,
      resolveLedgerPort: () =>
        ({ post } as unknown as SettlementLedgerPort),
    });

    const result = await worker.tickOnce();
    expect(result).toEqual({ claimed: 1, posted: 0, failed: 1, reclaimed: 0 });
    // Last write is a retry UPDATE (status back to pending, retry_count bumped),
    // NOT a publish.
    const last = calls[calls.length - 1]!.sql;
    expect(last).toContain('retry_count');
    expect(last).not.toContain('published');
  });
});

// ---------------------------------------------------------------------------
// crash-recovery — stale `processing` reclaim (closes the money-loss window)
// ---------------------------------------------------------------------------

describe('createSettlementDrainWorker — reclaims stale processing rows', () => {
  it('reclaims a stranded processing row to pending, then re-picks + posts it', async () => {
    const { db, calls } = makeScriptedDb([
      [{ id: 'evt_1' }], // reclaimStale UPDATE ... RETURNING — 1 stale row reclaimed
      [pendingRow()], // pick now sees the reclaimed row (back to pending)
      [{ id: 'evt_1' }], // claim
      [{ mineral: 'gold' }], // mineral
      [], // published
    ]);
    const { port, post } = stubLedgerPort();
    const worker = createSettlementDrainWorker({
      db,
      logger: noopLogger,
      resolveLedgerPort: () => port,
    });

    const result = await worker.tickOnce();
    // The stranded money leg is recovered: reclaimed=1, then posted.
    expect(result).toEqual({ claimed: 1, posted: 1, failed: 0, reclaimed: 1 });
    expect(post).toHaveBeenCalledTimes(1);
    // The FIRST statement is the reclaim: processing → pending, stale-locked.
    const first = calls[0]!.sql;
    expect(first).toContain('processing');
    expect(first).toContain('pending');
    expect(first).toContain('locked_at');
  });

  it('is idempotent — a reclaimed row that ALREADY posted replays the same journal, never double-posts', async () => {
    // The ledger port dedupes on the money-content key, so even if a crash left
    // the row processing AFTER a successful post, the replay returns the
    // original journal id — no second economic effect. We assert the worker
    // posts through the (idempotent) port exactly once per tick and republishes.
    const { db } = makeScriptedDb([
      [{ id: 'evt_1' }], // reclaim
      [pendingRow()], // pick
      [{ id: 'evt_1' }], // claim
      [{ mineral: 'gold' }], // mineral
      [], // published
    ]);
    const post = vi.fn(async () => ({ journalId: 'jrn_offtake_1' })); // same id on replay
    const worker = createSettlementDrainWorker({
      db,
      logger: noopLogger,
      resolveLedgerPort: () =>
        ({ post } as unknown as SettlementLedgerPort),
    });

    const result = await worker.tickOnce();
    expect(result).toEqual({ claimed: 1, posted: 1, failed: 0, reclaimed: 1 });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'offtake:agr-1' }),
    );
  });
});
