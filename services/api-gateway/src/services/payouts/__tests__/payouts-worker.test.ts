/**
 * payouts-worker tests.
 *
 * The worker takes an injected `db: { execute(q) }` so we can drive it
 * with `vi.fn()` whose resolved values mimic the rows the SELECT /
 * UPDATE / RETURNING queries produce. Each test asserts a specific
 * status-machine transition or invariant:
 *
 *   - empty queue: no provider call, no UPDATE
 *   - single happy-path row: provider called once, row marked published
 *   - provider error: retry_count incremented, next_retry_at set
 *   - retries exhausted: row transitioned to dead_letter
 *   - CAS contention: row already claimed -> skipped, provider not called
 *   - re-run on already-published row: not re-picked -> idempotent
 *   - tenant isolation: UPDATE always carries tenant_id predicate
 *   - invalid payload: marked for retry without provider call
 *   - pick batch failure: returns {0,0}, no throw
 *   - runOnce returns counts that match transitions
 */

import { describe, it, expect, vi } from 'vitest';

import { createPayoutsWorker } from '../payouts-worker';
import type { PayoutProvider } from '../stub-payout-provider';

const noopLogger = {
  warn: vi.fn(),
};

type ExecCall = {
  readonly sql: string;
};

function captureSqlText(q: unknown): string {
  // drizzle's `sql` template returns an SQL chunk object whose
  // `queryChunks` contains an alternating list of static-string
  // fragments and parameter objects (with a `.value` field). We
  // walk both so the captured text contains static SQL keywords
  // AND the bound parameter values for substring assertions.
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
              if (typeof v === 'object') {
                try {
                  return JSON.stringify(v);
                } catch {
                  return String(v);
                }
              }
              return String(v);
            }
            // StringChunk variants store the literal SQL in `value`
            // already handled, otherwise fall back to JSON.
            try {
              return JSON.stringify(obj);
            } catch {
              return '';
            }
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
 * Build a db whose `execute` answers a programmable script of
 * responses keyed by call index. Returns the captured raw queries
 * for SQL-shape assertions.
 */
function makeScriptedDb(script: ReadonlyArray<unknown>) {
  const calls: ExecCall[] = [];
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

function successProvider(): PayoutProvider {
  return {
    send: vi.fn(async (input) => ({
      providerRef: `stub_${input.idempotencyKey}`,
      status: 'completed' as const,
    })),
  };
}

function failingProvider(message = 'rail_unreachable'): PayoutProvider {
  return {
    send: vi.fn(async () => {
      throw new Error(message);
    }),
  };
}

const PROPOSAL = {
  tenantId: 'tenant-A',
  ownerId: 'owner-1',
  amountMinor: 750_000,
  currency: 'KES',
  destination: 'owner:owner@example.com',
  idempotencyKey: 'idem-A',
};

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt_1',
    tenant_id: 'tenant-A',
    aggregate_id: 'disb_idem-A',
    payload: PROPOSAL,
    metadata: { source: 'monthly-close-orchestrator', status: 'queued' },
    retry_count: 0,
    max_retries: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// runOnce — empty queue
// ---------------------------------------------------------------------------

describe('createPayoutsWorker.runOnce — empty queue', () => {
  it('returns {0,0} and never invokes the provider when no pending rows', async () => {
    const { db } = makeScriptedDb([[]]);
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('absorbs pick-batch failure and returns {0,0}', async () => {
    const warn = vi.fn();
    const db = {
      execute: vi.fn().mockRejectedValueOnce(new Error('pg down')),
    };
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: { warn },
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(provider.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: 'payouts',
        reason: 'pick_failed',
      }),
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// runOnce — happy path
// ---------------------------------------------------------------------------

describe('createPayoutsWorker.runOnce — happy path', () => {
  it('claims, dispatches via provider, and marks the row published', async () => {
    const { db, calls } = makeScriptedDb([
      [pendingRow()],          // pickPendingBatch
      [{ id: 'evt_1' }],       // claimRow CAS UPDATE ... RETURNING
      [],                       // markPublished UPDATE
    ]);
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-A',
        ownerId: 'owner-1',
        idempotencyKey: 'idem-A',
        amountMinor: 750_000,
      }),
    );
    // Final UPDATE should target 'published' status. Look at the last
    // call's captured SQL chunks.
    const finalSql = calls[calls.length - 1]?.sql ?? '';
    expect(finalSql).toContain('published');
  });

  it('parses payload from a JSON string field (Postgres jsonb stringified)', async () => {
    const { db } = makeScriptedDb([
      [pendingRow({ payload: JSON.stringify(PROPOSAL) })],
      [{ id: 'evt_1' }],
      [],
    ]);
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// runOnce — provider error → retry
// ---------------------------------------------------------------------------

describe('createPayoutsWorker.runOnce — retry on provider error', () => {
  it('increments retry_count and schedules next_retry_at on first failure', async () => {
    const { db, calls } = makeScriptedDb([
      [pendingRow({ retry_count: 0 })],
      [{ id: 'evt_1' }],          // claim ok
      [],                          // markFailureRetry UPDATE
    ]);
    const provider = failingProvider('mpesa_timeout');
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
      now: () => new Date('2026-05-01T00:00:00Z').getTime(),
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 1 });
    const finalSql = calls[calls.length - 1]?.sql ?? '';
    // Update should NOT be a dead-letter transition yet — first
    // failure stays in 'pending' status with bumped retry_count.
    expect(finalSql).toContain('pending');
    expect(finalSql).not.toContain('dead_letter');
  });

  it('transitions to dead_letter when retries are exhausted', async () => {
    const { db, calls } = makeScriptedDb([
      [pendingRow({ retry_count: 4, max_retries: 5 })],
      [{ id: 'evt_1' }],
      [],
    ]);
    const provider = failingProvider('exhaustion');
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 1 });
    const finalSql = calls[calls.length - 1]?.sql ?? '';
    expect(finalSql).toContain('dead_letter');
  });

  it('marks failure when provider returns non-completed status', async () => {
    const { db } = makeScriptedDb([
      [pendingRow()],
      [{ id: 'evt_1' }],
      [],
    ]);
    const provider: PayoutProvider = {
      send: vi.fn(async () => ({
        providerRef: 'stub_x',
        status: 'failed',
        failureReason: 'insufficient_funds',
      })),
    };
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 1 });
  });
});

// ---------------------------------------------------------------------------
// CAS contention + idempotency
// ---------------------------------------------------------------------------

describe('createPayoutsWorker.runOnce — CAS contention and idempotency', () => {
  it('skips a row when another worker has already claimed it (CAS returns 0 rows)', async () => {
    const { db } = makeScriptedDb([
      [pendingRow()],
      [],                          // claim returns 0 rows -> skipped
      // no further calls expected
    ]);
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('re-running with no pending rows does not double-pay (queue is drained)', async () => {
    const { db, execute } = makeScriptedDb([
      [pendingRow()],
      [{ id: 'evt_1' }],
      [],
      // second runOnce: empty pick
      [],
    ]);
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
    });
    const r1 = await worker.runOnce();
    const r2 = await worker.runOnce();
    expect(r1).toEqual({ processed: 1, failed: 0 });
    expect(r2).toEqual({ processed: 0, failed: 0 });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation + invalid payload
// ---------------------------------------------------------------------------

describe('createPayoutsWorker — tenant isolation + payload validation', () => {
  it('every UPDATE carries the row tenant_id (no cross-tenant writes)', async () => {
    const { db, calls } = makeScriptedDb([
      [pendingRow({ tenant_id: 'tenant-XYZ' })],
      [{ id: 'evt_1' }],
      [],
    ]);
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
    });
    await worker.runOnce();
    // Both UPDATE calls should mention tenant-XYZ in their bind chunks
    const updates = calls.slice(1);
    for (const c of updates) {
      expect(c.sql).toContain('tenant-XYZ');
    }
  });

  it('marks invalid-payload rows for retry without invoking the provider', async () => {
    const warn = vi.fn();
    const { db } = makeScriptedDb([
      [pendingRow({ payload: 'this-is-not-json' })],
      [{ id: 'evt_1' }],
      [],
    ]);
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: { warn },
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(provider.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: 'payouts',
        reason: 'invalid_payload',
      }),
      expect.any(String),
    );
  });
});
