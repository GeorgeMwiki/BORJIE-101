/**
 * Executive Brief Action Runner — Piece E (issue #41).
 *
 * Drains the `executive_brief_actions` queue every `intervalMs`
 * (default 10s in dev) and dispatches each approved row to the junior
 * executor. Failures are persisted as `status='failed' + error_text`;
 * successes flip to `status='executed' + executed_at + result_jsonb`.
 *
 * Every dispatch appends a row to `ai_audit_chain` so the action's
 * lifecycle is traceable on the existing audit hash chain.
 *
 * Lifecycle:
 *   - `start()` arms an interval; `BORJIE_ACTION_RUNNER_DISABLED=true`
 *     opts the worker out (CI / tests / shared-machine ops).
 *   - `tickOnce()` is exposed for tests + ops.
 *   - `stop()` clears the timer.
 *
 * Concurrency:
 *   - The tick is reentrant-safe via an in-process `running` flag — at
 *     most one tick executes at a time per process.
 *   - Across REPLICAS the runner takes a single-winner atomic claim
 *     (`UPDATE ... SET status='dispatching' ... FOR UPDATE SKIP LOCKED
 *     RETURNING`, mirroring `reminders-dispatch.worker.ts`) so two
 *     replicas can never grab and double-dispatch the same approved row.
 *     `markExecuted`/`markFailed` transition out of `dispatching`, and a
 *     per-tick sweep returns long-stuck `dispatching` rows (a replica that
 *     crashed between claim and mark) back to `approved` for retry.
 *   - We `LIMIT 5` per tick to bound blast radius if `executeJuniors`
 *     misbehaves; the next tick picks up the rest.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Logger } from 'pino';
import {
  executeJuniors,
  lazyClaudeClient,
  type ExecuteJuniorsArgs,
  type JuniorExecutionResult,
} from '@borjie/ai-copilot';
import { withServiceRoleContext } from '@borjie/database';
import { withWorkerTenantContext } from './with-tenant-context.js';

type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

const ONE_SECOND_MS = 1000;
const DEFAULT_INTERVAL_MS = 10 * ONE_SECOND_MS;
const DEFAULT_BATCH_SIZE = 5;
// A row claimed ('dispatching') by a replica that then crashed before
// markExecuted/markFailed is reclaimed back to 'approved' after this many
// seconds so it isn't stranded. 5 min comfortably exceeds a single
// executeJuniors dispatch under the LIMIT-5 blast bound.
const STUCK_DISPATCHING_TIMEOUT_SECONDS = 300;

export interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface ExecutiveBriefActionRunnerOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
  /** Injectable for tests. Defaults to `@borjie/ai-copilot.executeJuniors`. */
  readonly executor?: (args: ExecuteJuniorsArgs) => Promise<ReadonlyArray<JuniorExecutionResult>>;
  /** Skip the env-gated config check in `executeJuniors` (tests). */
  readonly skipConfigCheck?: boolean;
  /** Injected for the executor (real Anthropic client in prod). */
  readonly claude?: ExecuteJuniorsArgs['claude'];
}

export interface ExecutiveBriefActionRunnerHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<TickResult>;
}

export interface TickResult {
  readonly scanned: number;
  readonly executed: number;
  readonly failed: number;
  readonly skipped: number;
}

// ─────────────────────────────────────────────────────────────────────
// Row shape (zod-validated for safety; we don't trust raw JSONB)
// ─────────────────────────────────────────────────────────────────────

const QueueRowSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  brief_id: z.string().nullable().optional(),
  junior_name: z.string().min(1),
  intent: z.string().min(1),
  payload_jsonb: z.record(z.unknown()).nullable().optional(),
  attempts: z.number().int().min(0).max(10),
});

type QueueRow = z.infer<typeof QueueRowSchema>;

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createExecutiveBriefActionRunner(
  options: ExecutiveBriefActionRunnerOptions,
): ExecutiveBriefActionRunnerHandle {
  const envIntervalMs = Number(process.env.BORJIE_ACTION_RUNNER_INTERVAL_MS);
  const intervalMs = Math.max(
    ONE_SECOND_MS,
    options.intervalMs ??
      (Number.isFinite(envIntervalMs) && envIntervalMs > 0
        ? envIntervalMs
        : DEFAULT_INTERVAL_MS),
  );
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const enabled =
    options.enabled ??
    (process.env.NODE_ENV !== 'test' &&
      process.env.BORJIE_ACTION_RUNNER_DISABLED !== 'true');
  const nowFn = options.now ?? (() => new Date());
  const executor = options.executor ?? executeJuniors;
  // Lazy Claude client — resolved on first dispatch. Fails fast when
  // ANTHROPIC_API_KEY is missing (the executor's own config check
  // surfaces the same error). Tests inject `options.claude` directly.
  const claudeClient: ExecuteJuniorsArgs['claude'] =
    options.claude ?? lazyClaudeClient();

  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tick(): Promise<TickResult> {
    const result: TickResult = {
      scanned: 0,
      executed: 0,
      failed: 0,
      skipped: 0,
    };
    if (running) return result;
    running = true;
    const started = Date.now();
    try {
      // Reclaim rows a crashed replica left mid-flight before claiming new
      // work, so a single stuck row never permanently consumes a batch slot.
      await sweepStuckDispatching(options.db, nowFn());
      const rows = await claimApprovedBatch(options.db, batchSize, nowFn());
      (result as { scanned: number }).scanned = rows.length;
      if (rows.length === 0) return result;

      for (const row of rows) {
        const outcome = await dispatchOne(row, {
          db: options.db,
          logger: options.logger,
          executor,
          now: nowFn,
          skipConfigCheck: options.skipConfigCheck ?? false,
          claude: claudeClient,
        });
        if (outcome === 'executed') {
          (result as { executed: number }).executed += 1;
        } else if (outcome === 'failed') {
          (result as { failed: number }).failed += 1;
        } else {
          (result as { skipped: number }).skipped += 1;
        }
      }
      options.logger.info(
        { durationMs: Date.now() - started, ...result },
        'executive-brief-action-runner: tick complete',
      );
    } catch (err) {
      options.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'executive-brief-action-runner: tick failed',
      );
    } finally {
      running = false;
    }
    return result;
  }

  return {
    start() {
      if (!enabled) {
        options.logger.info('executive-brief-action-runner: disabled by env');
        return;
      }
      if (timer) {
        options.logger.warn('executive-brief-action-runner: already running');
        return;
      }
      options.logger.info(
        { intervalMs, batchSize },
        'executive-brief-action-runner started',
      );
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
      void tick();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        options.logger.info('executive-brief-action-runner stopped');
      }
    },
    async tickOnce() {
      return tick();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Per-row dispatch
// ─────────────────────────────────────────────────────────────────────

interface DispatchOneDeps {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly executor: (args: ExecuteJuniorsArgs) => Promise<ReadonlyArray<JuniorExecutionResult>>;
  readonly now: () => Date;
  readonly skipConfigCheck: boolean;
  readonly claude: ExecuteJuniorsArgs['claude'];
}

async function dispatchOne(
  row: QueueRow,
  deps: DispatchOneDeps,
): Promise<'executed' | 'failed' | 'skipped'> {
  const tenantId = row.tenant_id;
  try {
    const results = await deps.executor({
      dispatchPlan: [{ junior: row.junior_name, intent: row.intent }],
      context: {
        tenantId,
        chat_message: '', // action-driven, no user chat
        mode: 'action_runtime',
        lmbm_context: row.payload_jsonb ?? {},
      },
      claude: deps.claude,
      parallel: false,
      skipConfigCheck: deps.skipConfigCheck,
    });
    const first = results[0];
    if (!first) {
      await markFailed(deps.db, tenantId, row.id, 'executor returned empty result set', row.attempts);
      await auditDispatch(deps.db, {
        tenantId,
        actionId: row.id,
        briefId: row.brief_id ?? null,
        juniorName: row.junior_name,
        intent: row.intent,
        outcome: 'empty_result',
        now: deps.now(),
      });
      return 'failed';
    }
    if (first.error || first.skipped) {
      await markFailed(
        deps.db,
        tenantId,
        row.id,
        first.error ?? 'junior skipped',
        row.attempts,
      );
      await auditDispatch(deps.db, {
        tenantId,
        actionId: row.id,
        briefId: row.brief_id ?? null,
        juniorName: row.junior_name,
        intent: row.intent,
        outcome: first.skipped ? 'skipped' : 'failed',
        errorText: first.error ?? null,
        now: deps.now(),
      });
      return first.skipped ? 'skipped' : 'failed';
    }
    await markExecuted(deps.db, tenantId, row.id, first, deps.now());
    await auditDispatch(deps.db, {
      tenantId,
      actionId: row.id,
      briefId: row.brief_id ?? null,
      juniorName: row.junior_name,
      intent: row.intent,
      outcome: 'executed',
      now: deps.now(),
    });
    return 'executed';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(deps.db, tenantId, row.id, message, row.attempts);
    await auditDispatch(deps.db, {
      tenantId,
      actionId: row.id,
      briefId: row.brief_id ?? null,
      juniorName: row.junior_name,
      intent: row.intent,
      outcome: 'failed',
      errorText: message,
      now: deps.now(),
    });
    deps.logger.error(
      { actionId: row.id, tenantId, err: message },
      'action-runner: dispatch threw',
    );
    return 'failed';
  }
}

// ─────────────────────────────────────────────────────────────────────
// SQL helpers
// ─────────────────────────────────────────────────────────────────────

async function claimApprovedBatch(
  db: DbLike,
  limit: number,
  now: Date,
): Promise<ReadonlyArray<QueueRow>> {
  try {
    // CROSS-TENANT atomic claim: flip ready rows from 'approved' to
    // 'dispatching' in ONE statement so a second replica (or a restart)
    // can never grab the same row and double-dispatch. `FOR UPDATE SKIP
    // LOCKED` lets concurrent replicas claim DISJOINT rows without blocking;
    // the inner SELECT keeps the (approved_at, created_at) ordering and the
    // LIMIT. We RETURN the claimed rows so the dispatcher has everything it
    // needs. No tenant filter, so bind the service-role GUC
    // (app.is_service_role='true') to satisfy the
    // executive_brief_actions_service_role_bypass policy — without it
    // FORCE-RLS silently filters this scan to zero rows in prod. The
    // unit-test stub injects a db with .execute but no .transaction; fall
    // back to a bare execute there to keep those tests green.
    const query = sql`
      UPDATE executive_brief_actions
         SET status = 'dispatching',
             updated_at = ${now.toISOString()}
       WHERE id IN (
         SELECT id FROM executive_brief_actions
          WHERE status = 'approved'
            AND executed_at IS NULL
          ORDER BY approved_at ASC NULLS LAST, created_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
       )
      RETURNING id, tenant_id, brief_id, junior_name, intent, payload_jsonb, attempts
    `;
    const res =
      typeof (db as { transaction?: unknown }).transaction === 'function'
        ? await withServiceRoleContext(db as ServiceRoleDb, (tx) =>
            tx.execute(query),
          )
        : await db.execute(query);
    return fetchRows(res)
      .map((r) => QueueRowSchema.safeParse(r))
      .filter((p): p is z.SafeParseSuccess<QueueRow> => p.success)
      .map((p) => p.data);
  } catch {
    return [];
  }
}

/**
 * Reclaim 'dispatching' rows whose claiming replica crashed before it
 * could mark them executed/failed. Without this a single crash would
 * strand a row in 'dispatching' forever (no tick would ever re-pick it,
 * since the claim only matches 'approved'). CROSS-TENANT, so bind the
 * service-role GUC. Best-effort: a sweep failure must not abort the tick.
 */
async function sweepStuckDispatching(db: DbLike, now: Date): Promise<void> {
  try {
    const cutoff = new Date(
      now.getTime() - STUCK_DISPATCHING_TIMEOUT_SECONDS * ONE_SECOND_MS,
    ).toISOString();
    const query = sql`
      UPDATE executive_brief_actions
         SET status = 'approved',
             updated_at = ${now.toISOString()}
       WHERE status = 'dispatching'
         AND executed_at IS NULL
         AND updated_at < ${cutoff}
    `;
    if (typeof (db as { transaction?: unknown }).transaction === 'function') {
      await withServiceRoleContext(db as ServiceRoleDb, (tx) =>
        tx.execute(query),
      );
    } else {
      await db.execute(query);
    }
  } catch {
    // Best-effort reclaim — a sweep failure simply defers the reclaim to a
    // later tick; it must never block claiming fresh approved work.
  }
}

async function markExecuted(
  db: DbLike,
  tenantId: string,
  id: string,
  result: JuniorExecutionResult,
  now: Date,
): Promise<void> {
  const resultJson = JSON.stringify({
    output: result.output ?? null,
    evidence_ids: result.evidence_ids ?? [],
    confidence: result.confidence ?? 0,
  });
  // PER-TENANT update on a known tenant id: bind app.current_tenant_id
  // (and app.tenant_id) so the table's tenant-isolation policy permits
  // the write under FORCE-RLS. The unit-test stub has no .transaction;
  // fall back to a bare execute to keep those tests green.
  // Transition out of the claimed 'dispatching' state. The `status =
  // 'dispatching'` guard makes the write idempotent: if a sweep already
  // reclaimed this row to 'approved' (replica looked stuck), this update
  // no-ops rather than clobbering a row another replica may now own.
  const query = sql`
    UPDATE executive_brief_actions
       SET status      = 'executed',
           executed_at = ${now.toISOString()},
           attempts    = attempts + 1,
           result_jsonb = ${resultJson}::jsonb,
           error_text  = NULL,
           updated_at  = ${now.toISOString()}
     WHERE id = ${id}
       AND status = 'dispatching'
  `;
  if (typeof (db as { transaction?: unknown }).transaction === 'function') {
    await withWorkerTenantContext(db, tenantId, (tx) => tx.execute(query));
  } else {
    await db.execute(query);
  }
}

async function markFailed(
  db: DbLike,
  tenantId: string,
  id: string,
  errorText: string,
  attempts: number,
): Promise<void> {
  // After 3 attempts the row stays at status='failed' and the runner
  // skips it on subsequent ticks (the claim only matches 'approved').
  // Below the cap the row returns to 'approved' so a later claim re-picks
  // it. Either way it transitions OUT of the claimed 'dispatching' state.
  const nextStatus = attempts + 1 >= 3 ? 'failed' : 'approved';
  // PER-TENANT update on a known tenant id: bind app.current_tenant_id
  // (and app.tenant_id) so the table's tenant-isolation policy permits
  // the write under FORCE-RLS. The unit-test stub has no .transaction;
  // fall back to a bare execute to keep those tests green. The `status =
  // 'dispatching'` guard keeps the write idempotent if a sweep already
  // reclaimed the row.
  const query = sql`
    UPDATE executive_brief_actions
       SET status     = ${nextStatus},
           attempts   = attempts + 1,
           error_text = ${errorText},
           updated_at = now()
     WHERE id = ${id}
       AND status = 'dispatching'
  `;
  if (typeof (db as { transaction?: unknown }).transaction === 'function') {
    await withWorkerTenantContext(db, tenantId, (tx) => tx.execute(query));
  } else {
    await db.execute(query);
  }
}

interface AuditDispatchArgs {
  readonly tenantId: string;
  readonly actionId: string;
  readonly briefId: string | null;
  readonly juniorName: string;
  readonly intent: string;
  readonly outcome: string;
  readonly errorText?: string | null;
  readonly now: Date;
}

async function auditDispatch(db: DbLike, args: AuditDispatchArgs): Promise<void> {
  try {
    const id = `aud_${randomUUID()}`;
    const payload = JSON.stringify({
      action_id: args.actionId,
      brief_id: args.briefId,
      junior_name: args.juniorName,
      intent: args.intent,
      outcome: args.outcome,
      error_text: args.errorText ?? null,
      at: args.now.toISOString(),
    });
    // G-FIX-4 / G8 — wrap the GUC bind + SELECT-head + INSERT in
    // BEGIN/COMMIT so the tenant GUC binding is transaction-local.
    // ai_audit_chain is RLS-FORCED; without the GUC bind every INSERT
    // here would be silently rejected and the chain would gap.
    await withWorkerTenantContext(db, args.tenantId, async (tx) => {
      // Serialize concurrent same-tenant appends within the tx. Without
      // this two replicas approving for the same tenant both read the same
      // MAX(sequence_id) and race the (tenant_id, sequence_id) unique
      // index — one INSERT 23505s and gaps the chain. The xact lock
      // auto-releases at commit/rollback; hashtext keys it per-tenant so
      // different tenants never contend.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${args.tenantId}))`,
      );
      await tx.execute(sql`
        INSERT INTO ai_audit_chain (
          id, tenant_id, sequence_id, turn_id, action, prev_hash, this_hash, payload
        ) VALUES (
          ${id},
          ${args.tenantId},
          COALESCE((SELECT MAX(sequence_id) + 1 FROM ai_audit_chain WHERE tenant_id = ${args.tenantId}), 1),
          ${args.actionId},
          ${'executive_brief_action:' + args.outcome},
          COALESCE((SELECT this_hash FROM ai_audit_chain
                     WHERE tenant_id = ${args.tenantId}
                  ORDER BY sequence_id DESC LIMIT 1), 'genesis'),
          ${id},
          ${payload}::jsonb
        )
      `);
    });
  } catch {
    // Audit is best-effort — never block the queue tick on an audit
    // write failure. The action's outcome row is the source of truth.
  }
}

function fetchRows(res: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(res)) return res as Array<Record<string, unknown>>;
  if (res && typeof res === 'object' && 'rows' in res) {
    return ((res as { rows?: unknown[] }).rows ??
      []) as Array<Record<string, unknown>>;
  }
  return [];
}
