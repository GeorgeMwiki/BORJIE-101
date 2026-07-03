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
      execute: vi
        .fn()
        // reclaimStale succeeds (nothing stale), then pick fails.
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('pg down')),
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
      [],                       // reclaimStale (nothing stale)
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
      [],
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
      [],                          // reclaimStale
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
      [],                          // reclaimStale
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

  it('routes an INDETERMINATE dispatch to dead_letter reconciliation — never retried, no ledger post (double-pay guard)', async () => {
    const { db, calls } = makeScriptedDb([
      [],                          // reclaimStale
      [pendingRow({ retry_count: 0 })], // pick (fresh row — would normally retry)
      [{ id: 'evt_1' }],          // claim ok
      [],                          // markIndeterminate UPDATE (→ dead_letter)
    ]);
    // A timed-out B2C send: delivery unconfirmed, money MAY have moved.
    const provider: PayoutProvider = {
      send: vi.fn(async () => ({
        providerRef: 'mpesa_network_x',
        status: 'indeterminate' as const,
        failureReason: 'mpesa_b2c_network_error_indeterminate: aborted',
      })),
    };
    const ledgerPort = { post: vi.fn() };
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ledgerPort: ledgerPort as any,
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(provider.send).toHaveBeenCalledTimes(1);
    const finalSql = calls[calls.length - 1]?.sql ?? '';
    // Terminal reconciliation: dead_letter, and NOT a pending retry — a fresh
    // row (retry_count 0) that would normally be re-tried is instead parked, so
    // a possibly-sent payout is never auto-re-POSTed.
    expect(finalSql).toContain('dead_letter');
    expect(finalSql).not.toContain('next_retry_at');
    // The money-out ledger leg is NOT posted for an unconfirmed send.
    expect(ledgerPort.post).not.toHaveBeenCalled();
  });

  it('marks failure when provider returns non-completed status', async () => {
    const { db } = makeScriptedDb([
      [],
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
      [],                          // reclaimStale
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
      // run 1: reclaim, pick, claim, markPublished
      [],
      [pendingRow()],
      [{ id: 'evt_1' }],
      [],
      // run 2: reclaim, empty pick
      [],
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
    // run 1: reclaim + pick + claim + mark = 4; run 2: reclaim + pick = 2.
    expect(execute).toHaveBeenCalledTimes(6);
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation + invalid payload
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Service-role RLS wrapping (the born-dark trap this fix closes)
// ---------------------------------------------------------------------------

describe('createPayoutsWorker — service-role GUC wrapping under a real (tx-capable) db', () => {
  it('binds app.is_service_role=true for every outbox statement when db.transaction exists', async () => {
    // A transaction-capable db mimics the real Drizzle client: the worker MUST
    // route each outbox statement through withServiceRoleContext (which opens a
    // transaction and binds the service-role GUC) or FORCE-RLS returns 0 rows
    // and the money-out drain is born-dark.
    const boundGucs: string[] = [];
    const outboxCalls: string[] = [];
    const txExecute = vi.fn(async (q: unknown) => {
      const text = captureSqlText(q);
      // `set_config('app.is_service_role', 'true', ...)` is the GUC bind.
      if (text.includes('set_config')) boundGucs.push(text);
      else outboxCalls.push(text);
      // Return outbox row shapes for the pick/claim/mark script.
      if (text.includes('SELECT') && text.includes('event_outbox')) {
        return [pendingRow()];
      }
      if (text.includes('processing')) return [{ id: 'evt_1' }]; // claim CAS
      return [];
    });
    const tx = { execute: txExecute };
    const db = {
      execute: vi.fn(async () => []),
      // Real-client marker — presence flips the worker onto the wrapped path.
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const worker = createPayoutsWorker({
      db,
      provider: successProvider(),
      logger: noopLogger,
    });
    await worker.runOnce();
    // Every outbox statement ran INSIDE a service-role transaction, never on
    // the bare pooled connection.
    expect(db.transaction).toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
    // The GUC was bound to 'true' (not 'false') so the 0376 bypass policy admits.
    expect(boundGucs.some((g) => g.includes('true'))).toBe(true);
    expect(boundGucs.some((g) => g.includes('is_service_role'))).toBe(true);
    expect(outboxCalls.some((c) => c.includes('event_outbox'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cluster-supervisor surface (start / stop) — the boot wiring seam
// ---------------------------------------------------------------------------

describe('createPayoutsWorker — start() / stop() supervisor surface', () => {
  it('start() is a no-op when disabled (never touches the db)', () => {
    const { db, execute } = makeScriptedDb([[]]);
    const worker = createPayoutsWorker({
      db,
      provider: successProvider(),
      logger: { warn: vi.fn(), info: vi.fn() },
      enabled: false,
    });
    worker.start();
    expect(execute).not.toHaveBeenCalled();
    worker.stop(); // idempotent, safe even when never started
  });

  it('start() drives the drain loop then stop() halts it', async () => {
    const { db, execute } = makeScriptedDb([
      [pendingRow()],
      [{ id: 'evt_1' }],
      [],
      [], // subsequent empty picks
      [],
      [],
    ]);
    const worker = createPayoutsWorker({
      db,
      provider: successProvider(),
      logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
      enabled: true,
      intervalMs: 1,
    });
    worker.start();
    // Let at least one tick land.
    await new Promise((r) => setTimeout(r, 15));
    worker.stop();
    expect(execute).toHaveBeenCalled();
    const callsAfterStop = execute.mock.calls.length;
    await new Promise((r) => setTimeout(r, 15));
    // No new drains after stop() aborted the loop.
    expect(execute.mock.calls.length).toBe(callsAfterStop);
  });
});

describe('createPayoutsWorker — tenant isolation + payload validation', () => {
  it('every ROW-SCOPED UPDATE carries the row tenant_id (no cross-tenant writes)', async () => {
    const { db, calls } = makeScriptedDb([
      [],                                       // reclaimStale (cross-tenant, event-type scoped)
      [pendingRow({ tenant_id: 'tenant-XYZ' })], // pick
      [{ id: 'evt_1' }],                        // claim (row-scoped UPDATE)
      [],                                        // markPublished (row-scoped UPDATE)
    ]);
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
    });
    await worker.runOnce();
    // The claim + markPublished UPDATEs (calls[2], calls[3]) are ROW-scoped and
    // MUST carry the row tenant_id. The reclaim (calls[0]) is intentionally a
    // cross-tenant, event-type-scoped sweep and does not (cannot) carry a row
    // tenant_id — it runs under the service-role bypass, not per-row.
    const rowScoped = calls.slice(2);
    for (const c of rowScoped) {
      expect(c.sql).toContain('tenant-XYZ');
    }
    // Defence: the reclaim sweep must NOT be row-tenant-scoped (it is the
    // crash-recovery sweep across all tenants for this event type).
    expect(calls[0]?.sql).toContain('processing');
  });

  it('marks invalid-payload rows for retry without invoking the provider', async () => {
    const warn = vi.fn();
    const { db } = makeScriptedDb([
      [],
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

// ---------------------------------------------------------------------------
// BLOCKER 3 — reclaimStale (crash recovery) + wire-idempotent re-dispatch
// ---------------------------------------------------------------------------

describe('createPayoutsWorker — reclaimStale (Blocker 3)', () => {
  it('reclaims stale processing rows to pending as the FIRST statement each tick', async () => {
    // Script: [reclaimStale RETURNING], [pick], ... The reclaim UPDATE runs
    // before the pick, flipping crash-stranded processing rows back to pending.
    const { db, calls } = makeScriptedDb([
      [{ id: 'stuck_1' }], // reclaimStale RETURNING one reclaimed row
      [],                   // pick: empty (nothing else to do this tick)
    ]);
    const warn = vi.fn();
    const worker = createPayoutsWorker({
      db,
      provider: successProvider(),
      logger: { warn },
      now: () => new Date('2026-05-01T00:10:00Z').getTime(),
    });
    await worker.runOnce();
    // First statement is the reclaim UPDATE (processing -> pending).
    const first = calls[0]?.sql ?? '';
    expect(first).toContain('UPDATE');
    expect(first).toContain('processing');
    expect(first).toContain('pending');
    // Threshold predicate present (locked_at older than the stale bound).
    expect(first).toContain('locked_at');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ worker: 'payouts', reclaimed: 1 }),
      expect.any(String),
    );
  });

  it('a reclaimed row that re-dispatches uses the SAME idempotencyKey (wire-idempotent)', async () => {
    // reclaim returns 0, pick surfaces the (now-pending) row, claim wins, send.
    // The provider receives the ORIGINAL idempotencyKey so the deterministic
    // wire key + status-probe prevent a second debit — re-dispatch is safe.
    const { db } = makeScriptedDb([
      [],                    // reclaimStale: nothing stale
      [pendingRow()],        // pick surfaces the reclaimed row
      [{ id: 'evt_1' }],     // claim CAS
      [],                    // markPublished
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
      expect.objectContaining({ idempotencyKey: 'idem-A' }),
    );
  });

  it('a reclaim failure does not abort the tick (logs + continues to pick)', async () => {
    const { db } = makeScriptedDb([
      new Error('reclaim pg blip'), // reclaimStale throws
      [],                            // pick still runs
    ]);
    const warn = vi.fn();
    const worker = createPayoutsWorker({
      db,
      provider: successProvider(),
      logger: { warn },
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 0 });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ worker: 'payouts', reason: 'reclaim_failed' }),
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 4 — money-out ledger leg (posts once, replay-safe)
// ---------------------------------------------------------------------------

describe('createPayoutsWorker — money-out ledger leg (Blocker 4)', () => {
  it('posts the ledger money-out leg exactly once on a successful send', async () => {
    const { db, calls } = makeScriptedDb([
      [],                    // reclaimStale
      [pendingRow()],        // pick
      [{ id: 'evt_1' }],     // claim
      [],                    // markPublished
    ]);
    const provider = successProvider();
    const ledgerPost = vi.fn(async () => ({ journalId: 'jrn_1' }));
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
      ledgerPort: { post: ledgerPost },
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(ledgerPost).toHaveBeenCalledTimes(1);
    expect(ledgerPost).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-A',
        ownerId: 'owner-1',
        amountMinor: 750_000,
        currency: 'KES',
        idempotencyKey: 'idem-A',
      }),
    );
    // The journal id is recorded in the published row's metadata.
    const finalSql = calls[calls.length - 1]?.sql ?? '';
    expect(finalSql).toContain('published');
    expect(finalSql).toContain('jrn_1');
  });

  it('is replay-safe: a ledger port that dedupes returns the SAME journal on re-dispatch (no double-post)', async () => {
    // The ledger port is idempotent on a money key — two dispatches of the same
    // payout (e.g. reclaim + re-run) return the ORIGINAL journal id. We assert
    // the worker passes a stable idempotencyKey both times so the port CAN
    // dedupe (the dedupe itself is proven in the ledger adapter's own suite).
    const journalByKey = new Map<string, string>();
    let seq = 0;
    const ledgerPost = vi.fn(async (input: { idempotencyKey: string }) => {
      const existing = journalByKey.get(input.idempotencyKey);
      if (existing) return { journalId: existing };
      seq += 1;
      const jid = `jrn_${seq}`;
      journalByKey.set(input.idempotencyKey, jid);
      return { journalId: jid };
    });
    const provider = successProvider();
    // First dispatch.
    {
      const { db } = makeScriptedDb([[], [pendingRow()], [{ id: 'evt_1' }], []]);
      const worker = createPayoutsWorker({
        db,
        provider,
        logger: noopLogger,
        ledgerPort: { post: ledgerPost },
      });
      await worker.runOnce();
    }
    // Second dispatch of the SAME row (reclaimed after a crash-then-replay).
    {
      const { db } = makeScriptedDb([[], [pendingRow()], [{ id: 'evt_1' }], []]);
      const worker = createPayoutsWorker({
        db,
        provider,
        logger: noopLogger,
        ledgerPort: { post: ledgerPost },
      });
      await worker.runOnce();
    }
    expect(ledgerPost).toHaveBeenCalledTimes(2);
    // Both dispatches used the SAME idempotencyKey ⇒ the dedupe returns the
    // SAME journal ⇒ exactly one journal exists (no double-post).
    expect(journalByKey.size).toBe(1);
    expect(journalByKey.get('idem-A')).toBe('jrn_1');
  });

  it('does NOT mark published when the ledger post fails — leaves the row for idempotent retry', async () => {
    const { db, calls } = makeScriptedDb([
      [],                    // reclaimStale
      [pendingRow()],        // pick
      [{ id: 'evt_1' }],     // claim
      [],                    // markFailureRetry (ledger failed)
    ]);
    const warn = vi.fn();
    const provider = successProvider();
    const ledgerPost = vi.fn(async () => {
      throw new Error('ledger unavailable');
    });
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: { warn },
      ledgerPort: { post: ledgerPost },
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 1 });
    // Money moved (provider succeeded) but the row is NOT published — it stays
    // retryable so the reclaim path re-attempts the (idempotent) ledger post.
    const finalSql = calls[calls.length - 1]?.sql ?? '';
    expect(finalSql).not.toContain('published');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ worker: 'payouts', reason: 'ledger_post_failed' }),
      expect.any(String),
    );
  });

  it('skips ledger posting when no ledgerPort is wired (no fabrication)', async () => {
    const { db, calls } = makeScriptedDb([
      [],
      [pendingRow()],
      [{ id: 'evt_1' }],
      [],
    ]);
    const worker = createPayoutsWorker({
      db,
      provider: successProvider(),
      logger: noopLogger,
      // no ledgerPort
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 1, failed: 0 });
    const finalSql = calls[calls.length - 1]?.sql ?? '';
    expect(finalSql).toContain('published');
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 5 — kill-switch gate (fail-closed)
// ---------------------------------------------------------------------------

describe('createPayoutsWorker — kill-switch gate (Blocker 5)', () => {
  it('does NOT dispatch when the kill-switch is engaged; re-queues to pending', async () => {
    const { db, calls } = makeScriptedDb([
      [],                    // reclaimStale
      [pendingRow()],        // pick
      [{ id: 'evt_1' }],     // claim
      [],                    // requeuePendingHold UPDATE
    ]);
    const warn = vi.fn();
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: { warn },
      isKillSwitchEngaged: async () => true,
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 1 });
    // The provider was NEVER called — no money moved.
    expect(provider.send).not.toHaveBeenCalled();
    // The row is returned to pending (policy hold), NOT dead-lettered.
    const finalSql = calls[calls.length - 1]?.sql ?? '';
    expect(finalSql).toContain('pending');
    expect(finalSql).not.toContain('dead_letter');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ worker: 'payouts', reason: 'kill_switch_engaged' }),
      expect.any(String),
    );
  });

  it('fails CLOSED when the kill-switch check THROWS (treated as engaged, no dispatch)', async () => {
    const { db } = makeScriptedDb([
      [],
      [pendingRow()],
      [{ id: 'evt_1' }],
      [], // requeuePendingHold
    ]);
    const warn = vi.fn();
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: { warn },
      isKillSwitchEngaged: async () => {
        throw new Error('flag lookup down');
      },
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 0, failed: 1 });
    expect(provider.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        worker: 'payouts',
        reason: 'kill_switch_check_threw',
      }),
      expect.any(String),
    );
  });

  it('dispatches normally when the kill-switch is NOT engaged', async () => {
    const { db } = makeScriptedDb([
      [],
      [pendingRow()],
      [{ id: 'evt_1' }],
      [], // markPublished
    ]);
    const provider = successProvider();
    const worker = createPayoutsWorker({
      db,
      provider,
      logger: noopLogger,
      isKillSwitchEngaged: async () => false,
    });
    const result = await worker.runOnce();
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
});
