/**
 * In-process payouts worker.
 *
 * Drains `event_outbox` rows where
 *   `event_type = 'MonthlyCloseDisbursementProposed'`
 *   AND `status = 'pending'`
 *   AND (`next_retry_at IS NULL` OR `next_retry_at <= NOW()`)
 *
 * For each row:
 *   1. parse the proposal payload (tenantId / ownerId / amount /
 *      currency / destination / idempotencyKey),
 *   2. CAS the row from `pending` -> `processing` (so concurrent
 *      worker instances cannot double-pick),
 *   3. invoke the `PayoutProvider`,
 *   4. on success: write `status='published'`, set `processed_at` /
 *      `published_at`, and merge the audit trail
 *      (`{ provider_ref, dispatched_at, ... }`) into `metadata`,
 *   5. on failure: increment `retry_count`, set `last_error` +
 *      `next_retry_at` with exponential backoff. If retries are
 *      exhausted, transition to `dead_letter` so the standard DLQ
 *      worker can handle it.
 *
 * Idempotency strategy
 * --------------------
 * Three layers protect against double-pay:
 *
 *  - The orchestrator's `executeDisbursement` writes the outbox row
 *    keyed by `idempotencyKey` (correlation_id). Re-runs of monthly
 *    close cannot create duplicate proposals.
 *  - The CAS step (`UPDATE ... WHERE status='pending'`) ensures only
 *    one worker picks up a given row.
 *  - The terminal-state check (`status IN ('published','dead_letter')`)
 *    in the row picker ensures completed rows are never re-picked.
 *
 * Tenant isolation: every UPDATE/SELECT carries a `tenant_id` predicate
 * inherited from the row itself, so the worker never crosses tenants
 * even if the picker accidentally fetches multiple-tenant rows in
 * one batch.
 */

import { sql } from 'drizzle-orm';

import type { PayoutProvider } from './stub-payout-provider';
// F10 DecisionTrace — record each payout dispatch as one decision trace
// (amount, recipient, kill-switch state at decision time, approver
// chain). Fire-and-forget; provider call never blocks on persistence.
import { startDecisionTrace } from '@borjie/observability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Logger = {
  warn(meta: Record<string, unknown>, msg: string): void;
  info?(meta: Record<string, unknown>, msg: string): void;
  error?(meta: Record<string, unknown>, msg: string): void;
};

type DbExecutor = { execute(q: unknown): Promise<unknown> };

export type PayoutsWorkerDeps = {
  readonly db: DbExecutor;
  readonly provider: PayoutProvider;
  readonly logger: Logger;
  /** Number of rows to drain per `runOnce`. Defaults to 25. */
  readonly batchSize?: number;
  /** Backoff base in ms (real backoff = base * 2^retry_count). Defaults to 60_000. */
  readonly backoffBaseMs?: number;
  /** Test seam — defaults to `Date.now`. */
  readonly now?: () => number;
};

export type PayoutsWorkerRunResult = {
  readonly processed: number;
  readonly failed: number;
};

export type PayoutsWorker = {
  runOnce(): Promise<PayoutsWorkerRunResult>;
  runForever(intervalMs: number, signal?: AbortSignal): Promise<void>;
};

type ProposalPayload = {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly destination: string;
  readonly idempotencyKey: string;
};

type OutboxRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly payload: ProposalPayload | string;
  readonly metadata: Record<string, unknown> | string | null;
  readonly retryCount: number;
  readonly maxRetries: number;
};

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  if (typeof value === 'object') return value as T;
  return fallback;
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof v === 'bigint') return Number(v);
  return fallback;
}

function rowToOutbox(raw: Record<string, unknown>): OutboxRow {
  return {
    id: String(raw.id ?? ''),
    tenantId: String(raw.tenant_id ?? raw.tenantId ?? ''),
    aggregateId: String(raw.aggregate_id ?? raw.aggregateId ?? ''),
    payload: raw.payload as ProposalPayload | string,
    metadata: (raw.metadata as Record<string, unknown> | string | null) ?? null,
    retryCount: toNumber(raw.retry_count ?? raw.retryCount, 0),
    maxRetries: toNumber(raw.max_retries ?? raw.maxRetries, 5),
  };
}

function computeBackoffMs(retryCount: number, baseMs: number): number {
  // Exponential backoff capped at 24h to avoid runaway delays.
  const cap = 24 * 60 * 60 * 1000;
  const exp = Math.min(retryCount, 16);
  return Math.min(baseMs * 2 ** exp, cap);
}

function nextRetryIso(now: number, retryCount: number, baseMs: number): string {
  return new Date(now + computeBackoffMs(retryCount, baseMs)).toISOString();
}

function makeAuditMetadata(
  prev: Record<string, unknown> | string | null,
  audit: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    typeof prev === 'string'
      ? parseJsonField<Record<string, unknown>>(prev, {})
      : (prev ?? {});
  return {
    ...base,
    payouts_audit: audit,
  };
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_BACKOFF_BASE_MS = 60_000;
const DEFAULT_INTERVAL_MS = 5_000;

export function createPayoutsWorker(deps: PayoutsWorkerDeps): PayoutsWorker {
  const {
    db,
    provider,
    logger,
    batchSize = DEFAULT_BATCH_SIZE,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    now = Date.now,
  } = deps;

  const exec = db.execute.bind(db);

  async function pickPendingBatch(): Promise<readonly OutboxRow[]> {
    const res = await exec(sql`
      SELECT id, tenant_id, aggregate_id, payload, metadata,
             retry_count, max_retries
      FROM event_outbox
      WHERE event_type = 'MonthlyCloseDisbursementProposed'
        AND status = 'pending'
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at ASC
      LIMIT ${batchSize}
    `);
    return asRows(res).map(rowToOutbox);
  }

  async function claimRow(row: OutboxRow): Promise<boolean> {
    // CAS guard — if another worker already claimed this row the
    // UPDATE affects 0 rows and we skip.
    const res = await exec(sql`
      UPDATE event_outbox
      SET status = 'processing',
          locked_at = NOW()
      WHERE id = ${row.id}
        AND tenant_id = ${row.tenantId}
        AND status = 'pending'
      RETURNING id
    `);
    return asRows(res).length > 0;
  }

  async function markPublished(
    row: OutboxRow,
    providerRef: string,
  ): Promise<void> {
    const audit = makeAuditMetadata(row.metadata, {
      provider_ref: providerRef,
      dispatched_at: new Date(now()).toISOString(),
      status: 'completed',
    });
    await exec(sql`
      UPDATE event_outbox
      SET status = 'published',
          processed_at = NOW(),
          published_at = NOW(),
          metadata = ${JSON.stringify(audit)}::jsonb
      WHERE id = ${row.id}
        AND tenant_id = ${row.tenantId}
    `);
  }

  async function markFailureRetry(
    row: OutboxRow,
    err: unknown,
  ): Promise<void> {
    const newRetryCount = row.retryCount + 1;
    const message = err instanceof Error ? err.message : String(err);
    if (newRetryCount >= row.maxRetries) {
      const audit = makeAuditMetadata(row.metadata, {
        last_error: message,
        failed_at: new Date(now()).toISOString(),
        status: 'failed',
        retry_count: newRetryCount,
      });
      await exec(sql`
        UPDATE event_outbox
        SET status = 'dead_letter',
            retry_count = ${newRetryCount},
            last_error = ${message},
            metadata = ${JSON.stringify(audit)}::jsonb
        WHERE id = ${row.id}
          AND tenant_id = ${row.tenantId}
      `);
      return;
    }
    const nextRetry = nextRetryIso(now(), newRetryCount, backoffBaseMs);
    const audit = makeAuditMetadata(row.metadata, {
      last_error: message,
      retry_count: newRetryCount,
      next_retry_at: nextRetry,
      status: 'pending_retry',
    });
    await exec(sql`
      UPDATE event_outbox
      SET status = 'pending',
          retry_count = ${newRetryCount},
          last_error = ${message},
          next_retry_at = ${nextRetry},
          metadata = ${JSON.stringify(audit)}::jsonb
      WHERE id = ${row.id}
        AND tenant_id = ${row.tenantId}
      `);
  }

  async function processOne(row: OutboxRow): Promise<'processed' | 'failed' | 'skipped'> {
    const claimed = await claimRow(row);
    if (!claimed) return 'skipped';

    const proposal = parseJsonField<ProposalPayload | null>(
      row.payload,
      null,
    );
    if (!proposal || typeof proposal.idempotencyKey !== 'string') {
      await markFailureRetry(row, new Error('payouts_worker_invalid_payload'));
      logger.warn(
        {
          worker: 'payouts',
          outbox_id: row.id,
          tenantId: row.tenantId,
          reason: 'invalid_payload',
        },
        'payouts-worker: invalid proposal payload',
      );
      return 'failed';
    }

    // F10 DecisionTrace — bracket the dispatch decision. The brain
    // already evaluated "should we dispatch this payout?" upstream and
    // emitted a `MonthlyCloseDisbursementProposed` event; here we are
    // recording the EXECUTION decision and its outcome. The single
    // alternative is `defer` (kill-switch / retry on transient failure)
    // so the replay UI shows both paths even when we never take the
    // counterfactual.
    const trace = startDecisionTrace('payments.disburse', {
      inputs: {
        outboxId: row.id,
        ownerId: proposal.ownerId,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
        destinationKind: typeof proposal.destination === 'string'
          ? proposal.destination.split(':')[0] ?? 'unknown'
          : 'unknown',
        idempotencyKey: proposal.idempotencyKey,
        retryCount: row.retryCount,
        // Approver chain comes from the outbox metadata (set upstream by
        // monthly-close orchestrator after the approval gate clears).
        approvers: ((): unknown => {
          const md = parseJsonField<Record<string, unknown>>(row.metadata, {});
          return md.approvers ?? null;
        })(),
        // Kill-switch state at decision time — captured from metadata
        // (the orchestrator records it when it builds the proposal).
        killSwitchState: ((): unknown => {
          const md = parseJsonField<Record<string, unknown>>(row.metadata, {});
          return md.kill_switch_state ?? md.killSwitchState ?? null;
        })(),
      },
      context: {
        tenantId: proposal.tenantId,
        requestId: proposal.idempotencyKey,
      },
    });
    trace.addBranch({
      id: 'dispatch',
      label: 'Dispatch payout to provider',
      rationale: 'four-eye approval cleared upstream; outbox row pending',
    });
    trace.addBranch({
      id: 'defer',
      label: 'Defer / retry',
      rationale: 'counterfactual when provider returns non-completed or throws',
    });
    try {
      const result = await provider.send({
        tenantId: proposal.tenantId,
        ownerId: proposal.ownerId,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
        destination: proposal.destination,
        idempotencyKey: proposal.idempotencyKey,
      });
      if (result.status !== 'completed') {
        await markFailureRetry(
          row,
          new Error(result.failureReason ?? 'provider_returned_non_completed'),
        );
        trace.choose('defer', result.failureReason ?? 'provider_non_completed');
        trace.finalize({
          outcome: 'failed',
          output: {
            status: result.status,
            failureReason: result.failureReason ?? null,
          },
        });
        return 'failed';
      }
      await markPublished(row, result.providerRef);
      trace.choose('dispatch', 'provider returned completed');
      trace.finalize({
        outcome: 'executed',
        output: { providerRef: result.providerRef },
      });
      return 'processed';
    } catch (err) {
      await markFailureRetry(row, err);
      logger.warn(
        {
          worker: 'payouts',
          outbox_id: row.id,
          tenantId: row.tenantId,
          reason: 'provider_error',
          err: err instanceof Error ? err.message : String(err),
        },
        'payouts-worker: provider dispatch failed',
      );
      if (!trace.isFinalised()) {
        trace.choose('defer', 'provider threw');
        trace.finalize({
          outcome: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return 'failed';
    }
  }

  async function runOnce(): Promise<PayoutsWorkerRunResult> {
    let pending: readonly OutboxRow[] = [];
    try {
      pending = await pickPendingBatch();
    } catch (err) {
      logger.warn(
        {
          worker: 'payouts',
          reason: 'pick_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'payouts-worker: pick batch failed',
      );
      return { processed: 0, failed: 0 };
    }
    if (pending.length === 0) return { processed: 0, failed: 0 };

    let processed = 0;
    let failed = 0;
    for (const row of pending) {
      const outcome = await processOne(row);
      if (outcome === 'processed') processed += 1;
      else if (outcome === 'failed') failed += 1;
    }
    return { processed, failed };
  }

  async function runForever(
    intervalMs: number = DEFAULT_INTERVAL_MS,
    signal?: AbortSignal,
  ): Promise<void> {
    const safeInterval = intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
    while (!signal?.aborted) {
      try {
        await runOnce();
      } catch (err) {
        logger.warn(
          {
            worker: 'payouts',
            reason: 'run_once_threw',
            err: err instanceof Error ? err.message : String(err),
          },
          'payouts-worker: run_once threw — sleeping then retrying',
        );
      }
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, safeInterval);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  return { runOnce, runForever };
}
