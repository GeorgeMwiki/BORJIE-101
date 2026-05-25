/**
 * Consolidation worker — composition root.
 *
 * This is the cron-style entrypoint that wires the abstract worker
 * (`consolidation.ts`) to:
 *
 *   1. The Drizzle-backed reservoir source. Reads `kernel_cot_reservoir`
 *      rows from the last 24h where `consolidated_at IS NULL`, and
 *      marks them after the worker consumes them.
 *   2. The `@borjie/database` semantic memory service for fact
 *      writes (`createSemanticMemoryService.upsertFact`).
 *   3. A default stub consolidator (1 fact per 5 turns). The real
 *      Haiku consolidator is plug-in compatible — swap at the
 *      composition root only.
 *
 * Behaviour mirrors `services/api-gateway/src/composition/consolidation-
 * runner.ts` and `wake-loop-cron.ts`:
 *
 *   - Missing `DATABASE_URL` ⇒ supervisor logs + exits gracefully (no-op).
 *   - SIGTERM / SIGINT ⇒ loop.stop() then process.exit(0).
 *   - Any unhandled error inside a tick is absorbed by the worker
 *     itself — the loop never crashes on its own.
 */

import { sql } from 'drizzle-orm';
import {
  createSemanticMemoryService,
  createTemporalEntityGraphService,
  createSemanticBulkReEmbedService,
  type BulkReEmbedder,
} from '@borjie/database';
import {
  createConsolidationLoop,
  createStubConsolidator,
  type ReservoirEntry,
  type ReservoirSource,
  type SemanticSink,
  type WorkerLogger,
} from './consolidation.js';
import type { EntityConsolidatorPort } from './stages/06-consolidate.js';
import type { ReEmbedPort } from './stages/07-re-embed.js';
import type { ConstitutionalCriticPort } from './stages/03-reflect.js';
import { logger } from './logger.js';

// ─────────────────────────────────────────────────────────────────────
// Logger — tiny pino-shape that doesn't require pulling pino in.
// ─────────────────────────────────────────────────────────────────────

function consoleLogger(): WorkerLogger {
  return {
    info: (obj, msg) =>
      logger.info('[consolidation-worker]', { arg0: msg ?? '', obj })
      ,
    warn: (obj, msg) =>
      logger.warn('[consolidation-worker]', { arg0: msg ?? '', obj })
      ,
    error: (obj, msg) =>
      logger.error('[consolidation-worker]', { arg0: msg ?? '', obj })
      ,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Drizzle-backed reservoir source — reads kernel_cot_reservoir rows
// captured since `since` whose `consolidated_at IS NULL`. Marks them
// with NOW() after consumption.
//
// The `kernel_cot_reservoir` schema today (migration 0114) does NOT
// have a `consolidated_at` column or a `user_id` column. This adapter
// codes against those columns being added by a future migration —
// when missing, the SELECT returns zero rows and the worker is a
// benign no-op. Keeping the wiring intent-correct + reservoir schema
// extension OUT-OF-SCOPE here (task said do not touch packages/database/).
// ─────────────────────────────────────────────────────────────────────

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

function createReservoirSource(db: DrizzleLikeClient): ReservoirSource {
  return {
    async fetchUnconsolidated({ since, limit }) {
      try {
        const lim = clampLimit(limit, 5000);
        const result = (await db.execute(
          sql`SELECT thought_id, tenant_id, user_id, thread_id,
                     thought_text AS summary, captured_at
              FROM kernel_cot_reservoir
              WHERE consolidated_at IS NULL
                AND captured_at >= ${since}
                AND user_id IS NOT NULL
              ORDER BY captured_at DESC
              LIMIT ${lim}`,
        )) as unknown;
        const rows = toRows(result) as ReadonlyArray<{
          thought_id?: unknown;
          tenant_id?: unknown;
          user_id?: unknown;
          thread_id?: unknown;
          summary?: unknown;
          captured_at?: unknown;
        }>;
        const entries: ReservoirEntry[] = [];
        for (const row of rows) {
          const thoughtId = asString(row.thought_id);
          const userId = asString(row.user_id);
          if (!thoughtId || !userId) continue;
          entries.push({
            thoughtId,
            tenantId: asNullableString(row.tenant_id),
            userId,
            threadId: asString(row.thread_id) ?? '',
            summary: asString(row.summary) ?? '',
            capturedAt: asDateString(row.captured_at),
          });
        }
        return entries;
      } catch (error) {
        logger.warn('[consolidation-worker] reservoir fetch failed (schema may be pre-migration)', { value: asMessage(error) });
        return [];
      }
    },
    async markConsolidated(thoughtIds) {
      if (thoughtIds.length === 0) return;
      try {
        // Drizzle's `sql` template doesn't safely parameterise IN
        // lists by default — we pass an array literal via JSON.
        const idsJson = JSON.stringify(thoughtIds);
        await db.execute(
          sql`UPDATE kernel_cot_reservoir
              SET consolidated_at = NOW()
              WHERE thought_id = ANY(
                SELECT jsonb_array_elements_text(${idsJson}::jsonb)
              )`,
        );
      } catch (error) {
        // Rethrow so the worker logs + reports the error per-group.
        throw new Error(`markConsolidated: ${asMessage(error)}`);
      }
    },
  };
}

function createSemanticAdapter(db: DrizzleLikeClient): SemanticSink {
  const svc = createSemanticMemoryService(db as never);
  return {
    async upsertFact(args) {
      await svc.upsertFact({
        tenantId: args.tenantId,
        userId: args.userId,
        key: args.key,
        value: args.value,
        confidence: args.confidence,
        source: args.source,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Phase C C1 — B4 service wires for the 8-stage orchestrator.
//
// Stages 03 (reflect), 06 (consolidate), and 07 (re-embed) each accept
// an optional port supplied by the composition root. B4 shipped the
// three real services; this module is the wire-point that constructs
// each from a live Drizzle client and exposes them as a single deps
// bundle for the orchestrator to consume.
//
// Lazy / null-safe by design:
//   - When `db` is null (degraded mode / no DATABASE_URL), every port
//     in the bundle is null. The orchestrator stages skip themselves
//     cleanly (each stage's "no port wired" branch returns a zero-
//     impact report).
//   - The re-embed port additionally requires an embedder dep. When
//     no embedder is supplied, that single port is null while the
//     other two remain wired — partial degradation is supported.
//   - The constitutional critic adapter is built off the central-
//     intelligence kernel's factory. The kernel package barrel does
//     NOT currently re-export `createConstitutionalCritic`, so the
//     factory is loaded via dynamic import from the package dist (the
//     same sibling-service pattern the legacy db-client load uses).
//     When the dist is absent (e.g. unit tests with no install), the
//     critic resolves to null and stage 03 runs without the verdict.
// ─────────────────────────────────────────────────────────────────────

export interface OrchestratorB4Deps {
  readonly entityConsolidator: EntityConsolidatorPort | null;
  readonly reEmbedder: ReEmbedPort | null;
  readonly constitutionalCritic: ConstitutionalCriticPort | null;
}

export interface OrchestratorB4DepsOptions {
  /**
   * Embedder for stage 07. When omitted, the re-embedder port is null
   * and stage 07 becomes a no-op. Production wires a real OpenAI /
   * Voyage / local-model embedder here.
   */
  readonly embedder?: BulkReEmbedder | null;
  /**
   * Anthropic-compatible client passed through to the constitutional
   * critic. The critic itself falls back to a heuristic scorer when
   * the client is omitted, so this is also optional.
   */
  readonly anthropicClient?: ConstitutionalCriticAnthropicClient | null;
  /** Optional logger for the dynamic-import diagnostics. */
  readonly logger?: WorkerLogger;
}

/**
 * Minimal duck-type of the Anthropic messages client used by the
 * constitutional critic. Mirrored locally so this module compiles
 * without a compile-time dependency on `@anthropic-ai/sdk` or on the
 * central-intelligence package.
 */
export interface ConstitutionalCriticAnthropicClient {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ReadonlyArray<{ role: string; content: string }>;
    }): Promise<{
      content: ReadonlyArray<{ type: string; text?: string }>;
      model?: string;
    }>;
  };
}

/**
 * Build the orchestrator's B4 port bundle from a live Drizzle client.
 *
 * Returns a fully-null bundle when `db` is null — the orchestrator
 * stages skip themselves cleanly. Per-port nulls are independent: a
 * caller that wires the temporal-graph port but omits the embedder
 * gets stage 06 active and stage 07 skipped.
 */
export async function createOrchestratorB4Deps(
  db: DrizzleLikeClient | null,
  options: OrchestratorB4DepsOptions = {},
): Promise<OrchestratorB4Deps> {
  if (!db) {
    return {
      entityConsolidator: null,
      reEmbedder: null,
      constitutionalCritic: null,
    };
  }

  const entityConsolidator = wrapEntityConsolidator(db);
  const reEmbedder = options.embedder
    ? wrapReEmbedder(db, options.embedder)
    : null;
  const constitutionalCritic = await loadConstitutionalCritic({
    ...(options.anthropicClient ? { anthropicClient: options.anthropicClient } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });

  return {
    entityConsolidator,
    reEmbedder,
    constitutionalCritic,
  };
}

function wrapEntityConsolidator(
  db: DrizzleLikeClient,
): EntityConsolidatorPort {
  const svc = createTemporalEntityGraphService(db as never);
  return {
    async consolidateForTenant(args) {
      return svc.consolidateForTenant({ tenantId: args.tenantId });
    },
  };
}

function wrapReEmbedder(
  db: DrizzleLikeClient,
  embedder: BulkReEmbedder,
): ReEmbedPort {
  const svc = createSemanticBulkReEmbedService(db as never, embedder);
  return {
    async reEmbedForTenant(args) {
      return svc.reEmbedForTenant({
        tenantId: args.tenantId,
        limit: args.limit,
        ...(args.modelCutoff !== undefined ? { modelCutoff: args.modelCutoff } : {}),
      });
    },
  };
}

/**
 * Load `createConstitutionalCritic` via dynamic import. The kernel
 * package barrel does NOT re-export this factory at the time of
 * writing, so we reach into the dist directory directly. A missing
 * dist (e.g. fresh checkout without a build) resolves cleanly to
 * null and stage 03 runs without the verdict.
 *
 * Coordination zone (deferred): if a future PR adds
 * `createConstitutionalCritic` to the central-intelligence barrel
 * export, this helper can be replaced with a static
 * `import { createConstitutionalCritic } from '@borjie/central-intelligence'`
 * line. The current dynamic import is a tactical compromise that
 * avoids modifying packages outside the Phase C C1 scope.
 */
async function loadConstitutionalCritic(opts: {
  anthropicClient?: ConstitutionalCriticAnthropicClient;
  logger?: WorkerLogger;
}): Promise<ConstitutionalCriticPort | null> {
  try {
    const mod = (await import(
      '../../../packages/central-intelligence/dist/kernel/critics/constitutional-critic.js'
    )) as {
      createConstitutionalCritic?: (args?: {
        anthropicClient?: ConstitutionalCriticAnthropicClient;
      }) => ConstitutionalCriticPort;
    };
    if (typeof mod.createConstitutionalCritic !== 'function') {
      return null;
    }
    return mod.createConstitutionalCritic(
      opts.anthropicClient
        ? { anthropicClient: opts.anthropicClient }
        : undefined,
    );
  } catch (error) {
    const log = opts.logger?.warn ?? (() => undefined);
    log(
      { err: asMessage(error) },
      'consolidation-worker: constitutional critic load failed — stage 03 will run without verdict',
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main entry — env-driven boot, SIGTERM-safe shutdown.
// ─────────────────────────────────────────────────────────────────────

export interface MainOptions {
  /** Inject db for tests. Production reads DATABASE_URL via api-gateway db-client. */
  readonly db?: DrizzleLikeClient | null;
  readonly logger?: WorkerLogger;
  readonly intervalMs?: number;
}

export async function main(options: MainOptions = {}): Promise<void> {
  const logger = options.logger ?? consoleLogger();

  let db: DrizzleLikeClient | null = options.db ?? null;
  if (!db) {
    const dbUrl = process.env.DATABASE_URL?.trim();
    if (!dbUrl) {
      logger.warn({}, 'consolidation-worker: DATABASE_URL not set — supervisor is a no-op');
      return;
    }
    try {
      // Reuse the api-gateway db-client so the connection pool config
      // matches the rest of the platform. Lazy-imported so unit tests
      // never need a real DB connection.
      const mod = (await import(
        // @ts-expect-error — sibling-service import resolved by pnpm symlink
        '../../api-gateway/dist/composition/db-client.js'
      )) as { getDb?: () => unknown };
      db = (mod.getDb?.() ?? null) as DrizzleLikeClient | null;
    } catch (error) {
      logger.warn(
        { err: asMessage(error) },
        'consolidation-worker: db-client import failed — supervisor is a no-op',
      );
      return;
    }
    if (!db) {
      logger.warn({}, 'consolidation-worker: db-client returned null — supervisor is a no-op');
      return;
    }
  }

  const source = createReservoirSource(db);
  const sink = createSemanticAdapter(db);
  const consolidator = createStubConsolidator();
  const loop = createConsolidationLoop({
    source,
    sink,
    consolidator,
    logger,
    ...(typeof options.intervalMs === 'number' ? { intervalMs: options.intervalMs } : {}),
  });

  // SIGTERM-safe shutdown.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'consolidation-worker: shutdown requested');
    loop.stop();
    // Give in-flight tick room to finish (the loop's safeTick is
    // already guarded; we just want to flush pending logs before exit).
    setTimeout(() => process.exit(0), 50).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await loop.start();
}

// CLI guard — only run main() when this file is the program entry.
const isDirect =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /index(\.js|\.ts)?$/.test(process.argv[1]) &&
  process.argv[1].includes('consolidation-worker');

if (isDirect) {
  main().catch((error) => {
    logger.error('[consolidation-worker] fatal', { error: error });
    process.exit(2);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function clampLimit(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) return fallback;
  return Math.min(Math.floor(input), 50000);
}

function toRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows;
  return Array.isArray(wrapped) ? wrapped : [];
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function asNullableString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function asDateString(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date().toISOString();
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
