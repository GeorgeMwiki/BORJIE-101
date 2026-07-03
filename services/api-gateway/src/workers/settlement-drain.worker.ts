/**
 * Settlement Drain Worker — the money-leg consumer for signed offtake
 * agreements (LANE: mining-bid-accept-no-payment-trigger closeout).
 *
 * THE DEFECT THIS CLOSES: signing an offtake agreement enqueues a
 * `settlement.requested` row into the transactional `event_outbox`
 * (services/api-gateway/src/services/offtake-settlement.ts), but NO worker
 * consumed it — so the ledger post + seller settlement NEVER fired. The
 * money leg was dark end-to-end. This worker is the missing consumer.
 *
 * WHAT IT DOES, per tick:
 *   1. Pick `event_outbox` rows WHERE event_type='settlement.requested'
 *      AND status='pending' AND (next_retry_at IS NULL OR <= NOW()),
 *      oldest-first (the composite `event_type,status,created_at` index
 *      in outbox.schema.ts backs this pick).
 *   2. CAS each row `pending -> processing` so a second worker / replica
 *      cannot double-pick (mirrors payouts-worker.ts::claimRow).
 *   3. Compute the balanced settlement math (gross / royalty / fee / net)
 *      from the CONTRACT TERMS in the event payload — `agreedPriceTzs` is
 *      the TOTAL gross (not per-kg), `royalty` uses the per-mineral rate,
 *      `fee` is the platform fee, `net` is the exact integer remainder so
 *      the double-entry identity gross === royalty + fee + net holds.
 *   4. Post the balanced double-entry journal through the REAL
 *      `LedgerService.post()` via the shared SettlementLedgerPort
 *      (resolveSettlementLedgerPort) — the CLAUDE.md sole-money-writer
 *      rule. The ledger post is itself idempotent on a money-content key
 *      (settlementMoneyKey, H3), so a redelivery that reaches the post
 *      replays the ORIGINAL journal instead of double-posting.
 *   5. Mark the outbox row `published` (processed marker) so it is never
 *      re-picked.
 *   6. On failure: exponential backoff + retry; exhausted retries land in
 *      `dead_letter` for the standard DLQ.
 *
 * RLS SAFETY (the "service-role-darkness" trap prior workers hit): the
 * gateway prod role can enable FORCE ROW LEVEL SECURITY
 * (`BORJIE_ENFORCE_RLS`), so a cross-tenant SELECT on the shared pool that
 * binds NO tenant GUC returns ZERO rows and the loop goes silently dark.
 * Every outbox statement here therefore runs inside `withServiceRoleContext`
 * (binds `app.is_service_role='true'`), mirroring
 * reminders-dispatch.worker.ts::runStmt. That bind is admitted by the
 * `event_outbox_service_role_bypass` RLS policy shipped in migration
 * 0376_event_outbox_service_role_bypass.sql — WITHOUT that companion policy the
 * cross-tenant pick matches zero rows under enforced RLS and this money leg is
 * born-dark (the exact trap 0354 closed for reminders; 0376 is its
 * event_outbox twin). The LEDGER post runs inside
 * `withTenantContext(db, row.tenantId, ...)` so the chart-of-accounts
 * provisioning + journal writes are scoped to the settling (SELLER) tenant. The
 * unit-test mock (no `.transaction`) executes directly — there is nothing to
 * bind against an in-memory stub.
 *
 * CRASH RECOVERY: a claim (`pending -> processing`) that crashes before the
 * ledger post / `markPublished` would strand the row in `processing` forever —
 * for a MONEY leg that is a permanently un-posted settlement. `reclaimStale()`
 * flips `processing` rows whose `locked_at` is older than `reclaimAfterMs` back
 * to `pending` at the top of each tick so they retry. Re-processing is SAFE: the
 * ledger money-key dedupes, so a row that already posted (crash between post and
 * mark) replays the ORIGINAL journal — never a double-post.
 *
 * PAYOUT LAST-MILE: this worker posts the LEDGER settlement (the accounting
 * truth). The external seller DISBURSEMENT (M-Pesa B2C / Stripe transfer) is
 * a SEPARATE, kill-switch-gated rail (settlement-payout-adapter.ts,
 * BORJIE_SETTLEMENT_PAYOUT_ENABLED) that fails loud (PAYOUT_NOT_WIRED) until
 * a TZS seller-payout provider + per-seller destination resolver exist. We
 * do NOT fabricate a payout here: the ledger leg is real; the money-out leg
 * remains the existing provider path. Leaving the ledger posted (with the
 * seller_payable credit recorded) is the correct honest state.
 *
 * Idempotency is layered: (a) the pending-only pick + the CAS claim ensure
 * one worker processes a row once; (b) the ledger money-key dedupes a
 * genuine re-post; (c) the terminal `published`/`dead_letter` status keeps a
 * redelivered / replayed row from re-entering the pick.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { withServiceRoleContext, withTenantContext } from '@borjie/database';

import {
  resolveSettlementLedgerPort,
  royaltyRateForMineral,
  PLATFORM_FEE_RATE,
  type SettlementLedgerPort,
  type SettlementMath,
} from '../services/settlement';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';

const WORKER_NAME = 'settlement-drain';
const DEFAULT_INTERVAL_MS = 15_000;
const DEFAULT_BATCH = 25;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BACKOFF_BASE_MS = 60_000;
// A `processing` row older than this (its worker crashed mid-flight) is
// reclaimed to `pending` and retried. 5 min ≫ a normal post, so a live row is
// never yanked out from under the worker still holding it.
const DEFAULT_RECLAIM_AFTER_MS = 5 * 60_000;
const EVENT_TYPE = 'settlement.requested';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal db seam — a bare `{ execute }` so unit tests can stub it. */
export interface SettlementDrainDb {
  execute(query: unknown): Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction?: (...args: any[]) => any;
}

export interface SettlementDrainOptions {
  readonly db: SettlementDrainDb;
  readonly logger: Logger;
  /** Poll cadence. Defaults to 15s. */
  readonly intervalMs?: number;
  /** Rows drained per tick. Defaults to 25. */
  readonly batchSize?: number;
  /** Backoff base (real backoff = base * 2^retry_count). Defaults to 60s. */
  readonly backoffBaseMs?: number;
  /**
   * A `processing` row whose `locked_at` is older than this is reclaimed to
   * `pending` (crash-recovery). Defaults to 5 min.
   */
  readonly reclaimAfterMs?: number;
  /** Disable flag (parity with sibling workers). */
  readonly enabled?: boolean;
  /**
   * Ledger-port resolver seam (test override). Defaults to the shared
   * `resolveSettlementLedgerPort()` so the worker uses the SAME
   * LedgerService-backed port the RFB settlement orchestrator uses.
   */
  readonly resolveLedgerPort?: () => SettlementLedgerPort;
  /** Test seam — defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface SettlementDrainTickResult {
  readonly claimed: number;
  readonly posted: number;
  readonly failed: number;
  /** Stale `processing` rows reclaimed to `pending` this tick (crash-recovery). */
  readonly reclaimed: number;
}

export interface SettlementDrainHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<SettlementDrainTickResult>;
}

/** The wire contract enqueued by offtake-settlement.ts. */
interface SettlementRequestedPayload {
  readonly offtakeAgreementId: string;
  readonly bidId: string;
  readonly listingId: string;
  readonly buyerId: string;
  readonly buyerTenantId: string | null;
  readonly agreedPriceTzs: string;
  readonly quantityKg: string;
  readonly tenantId: string;
  readonly signedBy: string;
}

interface OutboxRow {
  readonly id: string;
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly payload: SettlementRequestedPayload | string | null;
  readonly retryCount: number;
  readonly maxRetries: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function parseJson<T>(value: unknown, fallback: T): T {
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

function toInt(v: unknown, fallback = 0): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
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
    payload: (raw.payload as SettlementRequestedPayload | string | null) ?? null,
    retryCount: toInt(raw.retry_count ?? raw.retryCount, 0),
    maxRetries: toInt(raw.max_retries ?? raw.maxRetries, DEFAULT_MAX_RETRIES),
  };
}

/**
 * Normalise a product-grade mineral string (e.g. `gold_concentrate`,
 * `tanzanite_rough`) down to a base mineral key so `royaltyRateForMineral`
 * resolves the correct rate. Unknown strings fall through to the default
 * royalty rate (the economically-safe default — same as the RFB path's
 * `'unknown'` behaviour). Pure.
 */
function baseMineralOf(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) return 'unknown';
  return raw.trim().toLowerCase().split(/[^a-z]+/)[0] ?? 'unknown';
}

/**
 * Compute the balanced settlement math for an offtake agreement. Unlike the
 * RFB path (gross = tonnage * price), `agreedPriceTzs` here is the TOTAL
 * negotiated gross, so gross === agreedPriceTzs. Royalty + fee are
 * independent integer legs; net is the exact integer remainder so the
 * double-entry identity gross === royalty + fee + net holds at integer
 * scale (the seller absorbs any sub-unit rounding residual — the correct
 * plug). Mirrors computeSettlementMath's discipline. Pure.
 */
export function computeOfftakeSettlementMath(input: {
  readonly agreedPriceTzs: string;
  readonly mineralKind: string;
}): SettlementMath {
  const grossTzs = Math.round(Number(input.agreedPriceTzs));
  if (!Number.isFinite(grossTzs) || grossTzs <= 0) {
    throw new Error(
      `computeOfftakeSettlementMath: agreedPriceTzs must be a positive ` +
        `number (got ${String(input.agreedPriceTzs)})`,
    );
  }
  const royaltyRate = royaltyRateForMineral(input.mineralKind);
  const royaltyTzs = Math.round(grossTzs * royaltyRate);
  const feeTzs = Math.round(grossTzs * PLATFORM_FEE_RATE);
  const netTzs = grossTzs - royaltyTzs - feeTzs;
  return { grossTzs, royaltyTzs, feeTzs, netTzs };
}

function computeBackoffMs(retryCount: number, baseMs: number): number {
  const cap = 24 * 60 * 60 * 1000; // 24h cap
  const exp = Math.min(retryCount, 16);
  return Math.min(baseMs * 2 ** exp, cap);
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export function createSettlementDrainWorker(
  options: SettlementDrainOptions,
): SettlementDrainHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const reclaimAfterMs = options.reclaimAfterMs ?? DEFAULT_RECLAIM_AFTER_MS;
  const enabled = options.enabled !== false;
  const now = options.now ?? Date.now;
  const resolveLedgerPort =
    options.resolveLedgerPort ?? resolveSettlementLedgerPort;
  let timer: ReturnType<typeof setInterval> | null = null;

  // Every OUTBOX statement drains CROSS-TENANT over the shared pool, so it
  // must bind the service-role GUC or FORCE-RLS returns ZERO rows (the
  // service-role-darkness trap). Wrap when transactional; the unit-test mock
  // (no `.transaction`) executes directly against the stub.
  function runOutboxStmt(query: unknown): Promise<unknown> {
    const dbAny = options.db as { transaction?: unknown };
    if (typeof dbAny.transaction === 'function') {
      return withServiceRoleContext(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options.db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tx: any) => tx.execute(query),
      );
    }
    return options.db.execute(query);
  }

  async function pickPending(): Promise<readonly OutboxRow[]> {
    const res = await runOutboxStmt(sql`
      SELECT id, tenant_id, aggregate_id, payload, retry_count, max_retries
        FROM event_outbox
       WHERE event_type = ${EVENT_TYPE}
         AND status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC
       LIMIT ${batchSize}
    `);
    return asRows(res).map(rowToOutbox);
  }

  /**
   * Crash-recovery: flip `processing` rows whose `locked_at` is older than
   * `reclaimAfterMs` back to `pending` so a worker that died mid-flight does not
   * permanently strand an un-posted settlement. Re-processing is idempotent (the
   * ledger money-key dedupes a replay), so this can never double-post. Scoped to
   * this event type only. Returns the number reclaimed.
   */
  async function reclaimStale(): Promise<number> {
    const staleBefore = new Date(now() - reclaimAfterMs).toISOString();
    const res = await runOutboxStmt(sql`
      UPDATE event_outbox
         SET status = 'pending', locked_at = NULL
       WHERE event_type = ${EVENT_TYPE}
         AND status = 'processing'
         AND locked_at IS NOT NULL
         AND locked_at < ${staleBefore}
      RETURNING id
    `);
    return asRows(res).length;
  }

  /** CAS `pending -> processing`. Returns true when THIS worker won the row. */
  async function claim(row: OutboxRow): Promise<boolean> {
    const res = await runOutboxStmt(sql`
      UPDATE event_outbox
         SET status = 'processing', locked_at = NOW()
       WHERE id = ${row.id}
         AND status = 'pending'
      RETURNING id
    `);
    return asRows(res).length > 0;
  }

  async function markPublished(row: OutboxRow, journalId: string): Promise<void> {
    await runOutboxStmt(sql`
      UPDATE event_outbox
         SET status = 'published',
             processed_at = NOW(),
             published_at = NOW(),
             metadata = COALESCE(metadata, '{}'::jsonb)
                        || ${JSON.stringify({ settlement_ledger_journal_id: journalId })}::jsonb
       WHERE id = ${row.id}
    `);
  }

  async function markFailureRetry(row: OutboxRow, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const nextRetryCount = row.retryCount + 1;
    if (nextRetryCount >= row.maxRetries) {
      await runOutboxStmt(sql`
        UPDATE event_outbox
           SET status = 'dead_letter',
               retry_count = ${nextRetryCount},
               last_error = ${message.slice(0, 4000)}
         WHERE id = ${row.id}
      `);
      return;
    }
    const nextRetryAt = new Date(
      now() + computeBackoffMs(nextRetryCount, backoffBaseMs),
    ).toISOString();
    await runOutboxStmt(sql`
      UPDATE event_outbox
         SET status = 'pending',
             retry_count = ${nextRetryCount},
             last_error = ${message.slice(0, 4000)},
             next_retry_at = ${nextRetryAt}
       WHERE id = ${row.id}
    `);
  }

  /**
   * Resolve the SELLER-tenant mineral kind for the royalty rate from the
   * listing's `attributes.mineral`. Runs inside the tenant's RLS scope.
   * Honest-degrade to 'unknown' (→ default royalty rate) on any miss — the
   * ledger post must not be blocked on an absent attribute.
   */
  async function resolveMineralKind(
    tenantId: string,
    listingId: string,
  ): Promise<string> {
    try {
      const res = await withTenantContext(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options.db as any,
        tenantId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (tx: any) =>
          tx.execute(sql`
            SELECT attributes ->> 'mineral' AS mineral,
                   category
              FROM marketplace_listings
             WHERE id = ${listingId}
             LIMIT 1
          `),
      );
      const r = asRows(res)[0];
      const mineral = r?.mineral ?? r?.category;
      return baseMineralOf(mineral);
    } catch {
      return 'unknown';
    }
  }

  async function processOne(
    row: OutboxRow,
  ): Promise<'posted' | 'failed' | 'skipped'> {
    const claimed = await claim(row);
    if (!claimed) return 'skipped';

    const payload = parseJson<SettlementRequestedPayload | null>(
      row.payload,
      null,
    );
    if (
      !payload ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.agreedPriceTzs !== 'string' ||
      typeof payload.offtakeAgreementId !== 'string'
    ) {
      await markFailureRetry(
        row,
        new Error('settlement_drain_invalid_payload'),
      );
      options.logger.warn(
        { worker: WORKER_NAME, outboxId: row.id, reason: 'invalid_payload' },
        'settlement-drain: invalid settlement.requested payload',
      );
      return 'failed';
    }

    const tenantId = payload.tenantId;
    try {
      const mineralKind = await resolveMineralKind(tenantId, payload.listingId);
      const math = computeOfftakeSettlementMath({
        agreedPriceTzs: payload.agreedPriceTzs,
        mineralKind,
      });

      // Post the balanced double-entry journal via the REAL LedgerService
      // (SettlementLedgerPort), scoped to the SELLER tenant's RLS context so
      // the chart-of-accounts provisioning + journal writes stay isolated.
      // `responseId` anchors the ledger money-key to this agreement; the port
      // dedupes on the money-content key so a redelivery replays the original
      // journal (no double-post).
      const ledgerPort = resolveLedgerPort();
      const ledgerResult = await withTenantContext(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options.db as any,
        tenantId,
        () =>
          ledgerPort.post({
            tenantId,
            responseId: payload.offtakeAgreementId,
            idempotencyKey: `offtake:${payload.offtakeAgreementId}`,
            math,
          }),
      );

      await markPublished(row, ledgerResult.journalId);
      options.logger.info(
        {
          worker: WORKER_NAME,
          outboxId: row.id,
          tenantId,
          offtakeAgreementId: payload.offtakeAgreementId,
          journalId: ledgerResult.journalId,
          grossTzs: math.grossTzs,
          royaltyTzs: math.royaltyTzs,
          feeTzs: math.feeTzs,
          netTzs: math.netTzs,
          mineralKind,
        },
        'settlement-drain: offtake settlement ledger posted',
      );
      return 'posted';
    } catch (err) {
      await markFailureRetry(row, err);
      options.logger.warn(
        {
          worker: WORKER_NAME,
          outboxId: row.id,
          tenantId,
          reason: 'ledger_post_failed',
          err: err instanceof Error ? err.message : String(err),
        },
        'settlement-drain: ledger post failed — will retry',
      );
      return 'failed';
    }
  }

  async function tickOnce(): Promise<SettlementDrainTickResult> {
    try {
      // Crash-recovery FIRST: return any stranded `processing` rows to `pending`
      // so this same tick can re-pick them (idempotent re-post — never doubled).
      const reclaimed = await reclaimStale();
      if (reclaimed > 0) {
        options.logger.warn(
          { worker: WORKER_NAME, reclaimed },
          'settlement-drain: reclaimed stale processing rows to pending',
        );
      }
      const pending = await pickPending();
      let posted = 0;
      let failed = 0;
      let claimedCount = 0;
      for (const row of pending) {
        const outcome = await processOne(row);
        if (outcome === 'skipped') continue;
        claimedCount += 1;
        if (outcome === 'posted') posted += 1;
        else failed += 1;
      }
      if (claimedCount > 0) {
        options.logger.info(
          { worker: WORKER_NAME, claimed: claimedCount, posted, failed, reclaimed },
          'settlement-drain: tick done',
        );
      }
      workerHeartbeat(WORKER_NAME);
      return { claimed: claimedCount, posted, failed, reclaimed };
    } catch (err) {
      workerHeartbeatFailure(WORKER_NAME, err);
      options.logger.warn(
        {
          worker: WORKER_NAME,
          reason: 'tick_threw',
          err: err instanceof Error ? err.message : String(err),
        },
        'settlement-drain: tick threw',
      );
      return { claimed: 0, posted: 0, failed: 0, reclaimed: 0 };
    }
  }

  function start(): void {
    if (!enabled) {
      options.logger.info(
        { worker: WORKER_NAME },
        'settlement-drain: disabled by config',
      );
      return;
    }
    if (timer) return;
    registerWorker({ name: WORKER_NAME, intervalMs });
    timer = setInterval(() => {
      tickOnce().catch((err) => {
        options.logger.error(
          {
            worker: WORKER_NAME,
            err: err instanceof Error ? err.message : String(err),
          },
          'settlement-drain: tick threw (outer)',
        );
      });
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    options.logger.info(
      { worker: WORKER_NAME, intervalMs },
      'settlement-drain: started',
    );
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tickOnce };
}
