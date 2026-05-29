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
import { withWorkerTenantContext } from './with-tenant-context.js';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

const ONE_SECOND_MS = 1000;
const DEFAULT_INTERVAL_MS = 10 * ONE_SECOND_MS;
const DEFAULT_BATCH_SIZE = 5;

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
      const rows = await fetchApprovedBatch(options.db, batchSize);
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
      await markFailed(deps.db, row.id, 'executor returned empty result set', row.attempts);
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
    await markExecuted(deps.db, row.id, first, deps.now());
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
    await markFailed(deps.db, row.id, message, row.attempts);
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

async function fetchApprovedBatch(
  db: DbLike,
  limit: number,
): Promise<ReadonlyArray<QueueRow>> {
  try {
    const res = await db.execute(sql`
      SELECT id, tenant_id, brief_id, junior_name, intent, payload_jsonb, attempts
        FROM executive_brief_actions
       WHERE status = 'approved'
         AND executed_at IS NULL
       ORDER BY approved_at ASC NULLS LAST, created_at ASC
       LIMIT ${limit}
    `);
    return fetchRows(res)
      .map((r) => QueueRowSchema.safeParse(r))
      .filter((p): p is z.SafeParseSuccess<QueueRow> => p.success)
      .map((p) => p.data);
  } catch {
    return [];
  }
}

async function markExecuted(
  db: DbLike,
  id: string,
  result: JuniorExecutionResult,
  now: Date,
): Promise<void> {
  const resultJson = JSON.stringify({
    output: result.output ?? null,
    evidence_ids: result.evidence_ids ?? [],
    confidence: result.confidence ?? 0,
  });
  await db.execute(sql`
    UPDATE executive_brief_actions
       SET status      = 'executed',
           executed_at = ${now.toISOString()},
           attempts    = attempts + 1,
           result_jsonb = ${resultJson}::jsonb,
           error_text  = NULL,
           updated_at  = ${now.toISOString()}
     WHERE id = ${id}
  `);
}

async function markFailed(
  db: DbLike,
  id: string,
  errorText: string,
  attempts: number,
): Promise<void> {
  // After 3 attempts the row stays at status='failed' and the runner
  // skips it on subsequent ticks (status filter is 'approved' only).
  const nextStatus = attempts + 1 >= 3 ? 'failed' : 'approved';
  await db.execute(sql`
    UPDATE executive_brief_actions
       SET status     = ${nextStatus},
           attempts   = attempts + 1,
           error_text = ${errorText},
           updated_at = now()
     WHERE id = ${id}
  `);
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
    await withWorkerTenantContext(db, args.tenantId, async () => {
      await db.execute(sql`
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
