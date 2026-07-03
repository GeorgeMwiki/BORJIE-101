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
 * Idempotency strategy (DOUBLE-PAY BARRIERS — real money out)
 * -----------------------------------------------------------
 *  - PRODUCER dedup (Blocker 2): `executeDisbursement` INSERTs the outbox row
 *    with `ON CONFLICT ... DO NOTHING` on the partial UNIQUE index
 *    `event_outbox_disbursement_dedup_uniq` (migration 0377) over
 *    (tenant_id, event_type, correlation_id). An orchestrator re-run of the
 *    same run+owner cannot create a duplicate proposal.
 *  - CAS claim: `UPDATE ... WHERE status='pending'` ensures only one worker /
 *    replica picks a given row.
 *  - Terminal-state pick: `status IN ('published','dead_letter')` rows are
 *    never re-picked.
 *  - CRASH RECOVERY (Blocker 3): `reclaimStale()` flips `processing` rows whose
 *    `locked_at` is older than `reclaimAfterMs` back to `pending` at the top of
 *    each tick, so a worker that died after claim (before mark) does not strand
 *    the payout forever.
 *  - WIRE idempotency (Blocker 1): re-dispatch of a reclaimed row is safe
 *    because the provider derives a DETERMINISTIC `OriginatorConversationID`
 *    from `idempotencyKey` and STATUS-PROBES before re-sending — a row that
 *    already debited Safaricom does not debit again.
 *  - LEDGER money-out (Blocker 4): on a successful send the worker posts the
 *    clearing/debit journal through `LedgerService.post()` via `ledgerPort`,
 *    deduped on a money-content key so a reclaim/replay replays the ORIGINAL
 *    journal (no double-post). A ledger fault leaves the row retryable (money
 *    moved but the leg is unrecorded is an honest RETRY, never a silent
 *    success), and the idempotent re-post + wire-idempotent re-send keep the
 *    retry safe.
 *  - KILL-SWITCH (Blocker 5): consulted fail-closed BEFORE each dispatch — a
 *    payout never fires while the switch is engaged; the row is re-queued to
 *    `pending` (policy hold, no retry-count bump) until the switch lifts.
 *
 * Tenant isolation: every UPDATE/SELECT carries a `tenant_id` predicate
 * inherited from the row itself, so the worker never crosses tenants
 * even if the picker accidentally fetches multiple-tenant rows in
 * one batch.
 *
 * RLS SAFETY (the "service-role-darkness" trap): this worker drains
 * `event_outbox` CROSS-TENANT over the shared service-role pool. Under
 * FORCE ROW LEVEL SECURITY (`BORJIE_ENFORCE_RLS=true`) a statement that
 * binds NO tenant GUC matches ZERO rows and the drain goes silently dark —
 * the exact born-dark class 0354 closed for reminders and 0376 for
 * event_outbox. Every outbox statement here therefore runs inside
 * `withServiceRoleContext` (binds `app.is_service_role='true'`), admitted by
 * the `event_outbox_service_role_bypass` policy shipped in migration
 * 0376_event_outbox_service_role_bypass.sql (the settlement-drain twin). The
 * wrap is applied only when the db seam is transactional (`.transaction` is a
 * function); the unit-test mock (a bare `{ execute }`) executes directly —
 * there is nothing to bind against an in-memory stub. Mirrors
 * settlement-drain.worker.ts::runOutboxStmt.
 *
 * PAYOUT PROVIDER (honest last-mile): the injected `PayoutProvider` is the
 * external disbursement rail (M-Pesa B2C / EFT). The composition root wires
 * the REAL env-driven rail or a typed FAIL-LOUD provider (EFT_NOT_CONFIGURED)
 * — never an always-success stub in production — so a row is marked
 * `published` ONLY after money actually moved; an unconfigured rail fails
 * loud, retries with backoff, then lands in `dead_letter`, never a fabricated
 * success.
 */

import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';

import type { PayoutProvider } from './stub-payout-provider';
import type { PayoutLedgerPort } from './payout-ledger-port';
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

/**
 * Minimal db seam — a bare `{ execute }` so unit tests can stub it. The
 * optional `transaction` marks a REAL Drizzle client: its presence gates the
 * `withServiceRoleContext` wrap (a stub without it executes directly).
 */
type DbExecutor = {
  execute(q: unknown): Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction?: (...args: any[]) => any;
};

export type PayoutsWorkerDeps = {
  readonly db: DbExecutor;
  readonly provider: PayoutProvider;
  readonly logger: Logger;
  /**
   * Ledger money-out port (Blocker 4). Posts the disbursement DEBIT leg
   * through the REAL `LedgerService.post()` (CLAUDE.md sole-money-writer rule)
   * on a SUCCESSFUL send, so the books reflect cash leaving via the rail.
   * The port is idempotent on a money-content key so a reclaim/replay does not
   * double-post. When omitted (no db / dev), ledger posting is skipped — the
   * composition root injects the real adapter in production.
   */
  readonly ledgerPort?: PayoutLedgerPort;
  /** Number of rows to drain per `runOnce`. Defaults to 25. */
  readonly batchSize?: number;
  /** Backoff base in ms (real backoff = base * 2^retry_count). Defaults to 60_000. */
  readonly backoffBaseMs?: number;
  /** Poll cadence for the `start()` supervisor loop. Defaults to 5_000. */
  readonly intervalMs?: number;
  /** Disable flag (parity with sibling workers). `start()` is a no-op when false. */
  readonly enabled?: boolean;
  /**
   * A `processing` row whose `locked_at` is older than this is reclaimed to
   * `pending` (crash-recovery — Blocker 3). Defaults to 5 min ≫ a normal
   * dispatch, so a live row is never yanked from a worker still holding it.
   * Re-dispatch is wire-idempotent because the provider's OriginatorConversationID
   * is deterministic and it status-probes before re-sending (mpesa-b2c-adapter).
   */
  readonly reclaimAfterMs?: number;
  /**
   * Kill-switch gate (Blocker 5). Consulted fail-closed BEFORE each provider
   * dispatch. When it resolves `true` the payout is NOT sent — the row is left
   * pending for the next tick. A throw is treated as ENGAGED (fail-closed): a
   * payout must never fire when we cannot confirm the switch is open. When
   * omitted, the gate is inert (no kill-switch wired) — the composition root is
   * responsible for injecting the real check.
   */
  readonly isKillSwitchEngaged?: (input: {
    readonly tenantId: string;
    readonly ownerId: string;
    readonly amountMinor: number;
  }) => Promise<boolean> | boolean;
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
  /**
   * Cluster-supervisor surface (parity with the sibling resident workers)
   * so the worker is a drop-in for `withClusterLeader(...).start()`. Drives
   * `runForever` on an internal AbortController; `start()` is idempotent and
   * a no-op when `enabled === false`. `stop()` aborts the loop.
   */
  start(): void;
  stop(): void;
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
// A `processing` row older than this had its worker crash mid-flight and is
// reclaimed to `pending`. 5 min ≫ a normal dispatch so a live row is never
// pulled from a worker still holding it (mirrors settlement-drain).
const DEFAULT_RECLAIM_AFTER_MS = 5 * 60_000;

export function createPayoutsWorker(deps: PayoutsWorkerDeps): PayoutsWorker {
  const {
    db,
    provider,
    logger,
    batchSize = DEFAULT_BATCH_SIZE,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    reclaimAfterMs = DEFAULT_RECLAIM_AFTER_MS,
    enabled = true,
    isKillSwitchEngaged,
    ledgerPort,
    now = Date.now,
  } = deps;

  // Every OUTBOX statement drains CROSS-TENANT over the shared pool, so it
  // must bind the service-role GUC or FORCE-RLS returns ZERO rows (the
  // service-role-darkness trap — closed for event_outbox by migration 0376).
  // Wrap when the db seam is transactional; the unit-test mock (a bare
  // `{ execute }` with no `.transaction`) executes directly against the stub.
  // Mirrors settlement-drain.worker.ts::runOutboxStmt.
  const exec = (query: unknown): Promise<unknown> => {
    const dbAny = db as { transaction?: unknown };
    if (typeof dbAny.transaction === 'function') {
      return withServiceRoleContext(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tx: any) => tx.execute(query),
      );
    }
    return db.execute(query);
  };

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

  /**
   * Crash-recovery (Blocker 3): flip `MonthlyCloseDisbursementProposed` rows
   * whose `locked_at` is older than `reclaimAfterMs` from `processing` back to
   * `pending` so a worker that died mid-flight (after CAS-claim, before
   * mark) does not permanently strand a payout. Scoped to this event type +
   * a non-null `locked_at` older than the threshold so a live in-flight row is
   * never reclaimed. Re-dispatch is WIRE-IDEMPOTENT: the provider's
   * OriginatorConversationID is deterministic (mpesa-b2c-adapter barrier 1) and
   * it status-probes before re-sending (barrier 2), so a row that already
   * debited Safaricom (crash between send and mark) does NOT debit again.
   * Returns the number reclaimed.
   */
  async function reclaimStale(): Promise<number> {
    const staleBefore = new Date(now() - reclaimAfterMs).toISOString();
    const res = await exec(sql`
      UPDATE event_outbox
      SET status = 'pending',
          locked_at = NULL
      WHERE event_type = 'MonthlyCloseDisbursementProposed'
        AND status = 'processing'
        AND locked_at IS NOT NULL
        AND locked_at < ${staleBefore}
      RETURNING id
    `);
    return asRows(res).length;
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
    journalId?: string,
  ): Promise<void> {
    const audit = makeAuditMetadata(row.metadata, {
      provider_ref: providerRef,
      dispatched_at: new Date(now()).toISOString(),
      status: 'completed',
      ...(journalId ? { money_out_journal_id: journalId } : {}),
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

  /**
   * Policy HOLD re-queue (kill-switch defer, Blocker 5). Returns a claimed
   * (`processing`) row to `pending` and clears `locked_at` WITHOUT bumping
   * retry_count — a kill-switch hold is a policy decision, not a delivery
   * failure, so it must never push the row toward `dead_letter`. The row is
   * re-picked on a later tick; once the switch is lifted it dispatches
   * normally. No money moved, so nothing on the wire to reconcile.
   */
  async function requeuePendingHold(row: OutboxRow): Promise<void> {
    const audit = makeAuditMetadata(row.metadata, {
      status: 'kill_switch_hold',
      held_at: new Date(now()).toISOString(),
    });
    await exec(sql`
      UPDATE event_outbox
      SET status = 'pending',
          locked_at = NULL,
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

  /**
   * INDETERMINATE dispatch (a money-out POST whose delivery could not be
   * confirmed — e.g. a B2C timeout / 5xx). Money MAY already have moved, so we
   * must NEVER auto-retry (that risks a double-debit on a rail that does not
   * dedup on the wire key) and must NOT post the ledger leg (we don't know the
   * money moved). Route to terminal `dead_letter` flagged for reconciliation:
   * a human — or a configured Transaction-Status probe on a later manual replay
   * — resolves the true state before any re-send. reclaimStale only touches
   * `processing` rows, so a dead_letter row is never resurrected automatically.
   */
  async function markIndeterminate(
    row: OutboxRow,
    reason: string | undefined,
  ): Promise<void> {
    const message = reason ?? 'payout_indeterminate';
    const audit = makeAuditMetadata(row.metadata, {
      last_error: message,
      indeterminate_at: new Date(now()).toISOString(),
      status: 'needs_reconciliation',
      reconciliation_required: true,
    });
    await exec(sql`
      UPDATE event_outbox
      SET status = 'dead_letter',
          last_error = ${message},
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

    // KILL-SWITCH GATE (Blocker 5), fail-closed. A payout must NOT fire when
    // the kill-switch is engaged. We consult it AFTER the CAS-claim (so we do
    // not race another worker) and BEFORE `provider.send` (so no money moves).
    // When engaged — or when the check THROWS (fail-closed: we cannot confirm
    // the switch is open) — we return the row to `pending` WITHOUT bumping
    // retry_count (a policy hold is not a failure) so it dispatches once the
    // switch is lifted, and we do NOT let it drift toward dead_letter.
    if (isKillSwitchEngaged) {
      let engaged = true;
      try {
        engaged = await isKillSwitchEngaged({
          tenantId: proposal.tenantId,
          ownerId: proposal.ownerId,
          amountMinor: proposal.amountMinor,
        });
      } catch (err) {
        engaged = true; // fail-closed
        logger.warn(
          {
            worker: 'payouts',
            outbox_id: row.id,
            tenantId: row.tenantId,
            reason: 'kill_switch_check_threw',
            err: err instanceof Error ? err.message : String(err),
          },
          'payouts-worker: kill-switch check threw — treating as ENGAGED (fail-closed)',
        );
      }
      if (engaged) {
        await requeuePendingHold(row);
        logger.warn(
          {
            worker: 'payouts',
            outbox_id: row.id,
            tenantId: row.tenantId,
            reason: 'kill_switch_engaged',
          },
          'payouts-worker: kill-switch engaged — payout deferred, not dispatched',
        );
        trace.choose('defer', 'kill-switch engaged');
        trace.finalize({
          outcome: 'failed',
          output: { deferred: true, reason: 'kill_switch_engaged' },
        });
        return 'failed';
      }
    }

    try {
      const result = await provider.send({
        tenantId: proposal.tenantId,
        ownerId: proposal.ownerId,
        amountMinor: proposal.amountMinor,
        currency: proposal.currency,
        destination: proposal.destination,
        idempotencyKey: proposal.idempotencyKey,
      });
      if (result.status === 'indeterminate') {
        // Delivery unconfirmed — money MAY have moved. Terminal reconciliation,
        // NEVER auto-retry, NO ledger post. Closes the double-pay window on a
        // rail (M-Pesa) that does not dedup on the wire key.
        await markIndeterminate(row, result.failureReason);
        trace.choose('defer', result.failureReason ?? 'payout_indeterminate');
        trace.finalize({
          outcome: 'failed',
          output: {
            status: 'indeterminate',
            failureReason: result.failureReason ?? null,
            reconciliationRequired: true,
          },
        });
        return 'failed';
      }
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
      // LEDGER MONEY-OUT LEG (Blocker 4). Money left via the rail — record the
      // clearing/debit journal BEFORE marking published, through the REAL
      // LedgerService (CLAUDE.md sole-money-writer rule). The port dedupes on a
      // money-content key, so a reclaim/replay (crash between post and mark)
      // replays the ORIGINAL journal — never a double-post. A ledger fault does
      // NOT mark the row published (money moved but the leg is unrecorded is an
      // honest RETRY, not a silent success): we leave it for retry so the
      // reclaim path re-attempts the post (the deterministic wire key +
      // status-probe keep the re-dispatch from re-debiting).
      if (ledgerPort) {
        let journalId: string;
        try {
          const posted = await ledgerPort.post({
            tenantId: proposal.tenantId,
            ownerId: proposal.ownerId,
            amountMinor: proposal.amountMinor,
            currency: proposal.currency,
            idempotencyKey: proposal.idempotencyKey,
            providerRef: result.providerRef,
          });
          journalId = posted.journalId;
        } catch (ledgerErr) {
          await markFailureRetry(row, ledgerErr);
          logger.warn(
            {
              worker: 'payouts',
              outbox_id: row.id,
              tenantId: row.tenantId,
              reason: 'ledger_post_failed',
              err:
                ledgerErr instanceof Error
                  ? ledgerErr.message
                  : String(ledgerErr),
            },
            'payouts-worker: money-out ledger post failed — will retry (money already moved; replay is idempotent)',
          );
          trace.choose('defer', 'ledger post failed after send');
          trace.finalize({
            outcome: 'failed',
            error:
              ledgerErr instanceof Error
                ? ledgerErr.message
                : String(ledgerErr),
          });
          return 'failed';
        }
        await markPublished(row, result.providerRef, journalId);
        trace.choose('dispatch', 'provider completed; money-out ledger posted');
        trace.finalize({
          outcome: 'executed',
          output: { providerRef: result.providerRef, journalId },
        });
        return 'processed';
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
    // Crash-recovery FIRST (Blocker 3): return any stranded `processing` rows
    // to `pending` so this same tick can re-pick them. Wire-idempotent
    // re-dispatch means a reclaimed row that already moved money will NOT move
    // it again. A reclaim fault must not abort the tick — log and continue.
    try {
      const reclaimed = await reclaimStale();
      if (reclaimed > 0) {
        logger.warn(
          { worker: 'payouts', reclaimed },
          'payouts-worker: reclaimed stale processing rows to pending',
        );
      }
    } catch (err) {
      logger.warn(
        {
          worker: 'payouts',
          reason: 'reclaim_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'payouts-worker: reclaimStale failed — continuing tick',
      );
    }

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

  // ── Cluster-supervisor surface — drop-in for withClusterLeader(...).start() ──
  let controller: AbortController | null = null;

  function start(): void {
    if (!enabled) {
      logger.info?.(
        { worker: 'payouts' },
        'payouts-worker: disabled by config',
      );
      return;
    }
    if (controller) return; // idempotent
    controller = new AbortController();
    const signal = controller.signal;
    void runForever(intervalMs, signal).catch((err) => {
      logger.error?.(
        {
          worker: 'payouts',
          err: err instanceof Error ? err.message : String(err),
        },
        'payouts-worker: runForever exited',
      );
    });
    logger.info?.(
      { worker: 'payouts', intervalMs },
      'payouts-worker: started',
    );
  }

  function stop(): void {
    if (controller) {
      controller.abort();
      controller = null;
    }
  }

  return { runOnce, runForever, start, stop };
}
