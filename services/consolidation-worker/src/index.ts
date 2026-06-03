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
  createSkillRegistryService,
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
import {
  runConsolidationOrchestrator,
  type ConsolidationOrchestratorDeps,
} from './orchestrator.js';
import type { EntityConsolidatorPort } from './stages/06-consolidate.js';
import type { ReEmbedPort } from './stages/07-re-embed.js';
import type { ConstitutionalCriticPort } from './stages/03-reflect.js';
import type { IngestSources } from './stages/01-ingest.js';
import type {
  ConsolidationEmbedder,
  ImplicitSignalEntry,
  SkillRegistryPort,
  StageLogger,
  TraceEntry,
} from './stages/types.js';
import { logger } from './logger.js';
import {
  runOcrExtractionPollWithGatewayAdapters,
  type OcrExtractionDb,
} from './tasks/ocr-extraction-task.js';
import {
  buildLedgerAttestorCronDeps,
  runLedgerAttestorCron,
  type AttestorDbLike,
} from './tasks/ledger-attestor-cron.js';

// Async per-upload OCR + full-text extraction poll cadence. Documents that
// flip to `ingestion_status='ready'` are picked up here; default every 30s,
// clamped to [5s, 10min].
function resolveOcrPollMs(): number {
  const raw = Number(process.env.OCR_EXTRACTION_POLL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 30_000;
  return Math.min(Math.max(Math.floor(raw), 5_000), 600_000);
}

// 8-stage sleep-time consolidation orchestrator cadence (stages 01→09,
// including 04-promote → skill_registry). This is the heavyweight nightly
// cascade, distinct from the lightweight reservoir→semantic consolidation
// loop above. Default every 24h; clamped to [1min, 7d] so a deploy can
// dial it down for staging without letting it run unboundedly often.
function resolveOrchestratorIntervalMs(): number {
  const raw = Number(process.env.CONSOLIDATION_ORCHESTRATOR_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 24 * 60 * 60 * 1000;
  return Math.min(Math.max(Math.floor(raw), 60_000), 7 * 24 * 60 * 60 * 1000);
}

// Ledger / audit hash-chain attestor cadence (LP-19). The attestor is a
// read-only periodic job that signs a Merkle root over the ledger + audit
// chains and publishes the checkpoint to a WORM sink. Documented default is
// HOURLY; env-tunable + clamped to [5min, 24h] so a deploy can dial it for
// staging without letting it run unboundedly often.
function resolveAttestorIntervalMs(): number {
  const raw = Number(process.env.LEDGER_ATTEST_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 60 * 60 * 1000;
  return Math.min(Math.max(Math.floor(raw), 5 * 60 * 1000), 24 * 60 * 60 * 1000);
}

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
// Drizzle-backed ingest sources for the 8-stage orchestrator (stage 01).
//
// Three independent reads, each degrading to an empty array on any
// failure (pre-migration schema, transient DB error) so a missing source
// never stalls the cascade — stage 01's own `safe(...)` wrapper double-
// guards this:
//
//   - fetchTraces           → `kernel_cot_reservoir` (the chain-of-thought
//                             ribbon; same column set the consolidation
//                             reservoir source reads).
//   - fetchImplicitSignals  → `implicit_feedback_signals` (copy / re-prompt
//                             / override / … — the >99% of feedback that
//                             isn't a thumbs; migration 0133 family).
//   - fetchExplicitFeedback → empty for now. There is no single canonical
//                             thumbs/correction table whose shape matches
//                             `FeedbackEntry`; the implicit ribbon already
//                             carries the success/failure signal stage 02
//                             clusters on. Wiring an explicit source is a
//                             follow-up and is intentionally OUT OF SCOPE
//                             here (no new migration).
//
// Window bounds (`since`/`until`) come from stage 01; we honour them in
// the SQL so the worker only ever inspects the rolling window.
// ─────────────────────────────────────────────────────────────────────

function createReservoirIngestSources(db: DrizzleLikeClient): IngestSources {
  return {
    async fetchTraces({ since, until, limit }) {
      try {
        const lim = clampLimit(limit, 5000);
        const result = (await db.execute(
          sql`SELECT thought_id, tenant_id, user_id, thread_id,
                     thought_text AS summary, captured_at
              FROM kernel_cot_reservoir
              WHERE captured_at >= ${since}
                AND captured_at < ${until}
                AND user_id IS NOT NULL
              ORDER BY captured_at DESC
              LIMIT ${lim}`,
        )) as unknown;
        const rows = toRows(result);
        const out: TraceEntry[] = [];
        for (const row of rows) {
          const traceId = asString(row.thought_id);
          const userId = asString(row.user_id);
          if (!traceId || !userId) continue;
          out.push({
            traceId,
            tenantId: asNullableString(row.tenant_id),
            userId,
            threadId: asString(row.thread_id) ?? '',
            summary: asString(row.summary) ?? '',
            capturedAt: asDateString(row.captured_at),
          });
        }
        return out;
      } catch (error) {
        logger.warn('[consolidation-worker] ingest fetchTraces failed (schema may be pre-migration)', { value: asMessage(error) });
        return [];
      }
    },
    async fetchImplicitSignals({ since, until, limit }) {
      try {
        const lim = clampLimit(limit, 5000);
        const result = (await db.execute(
          sql`SELECT id, trace_id, agent_action_id, tenant_id, user_id,
                     surface, signal_type, strength, emitted_at
              FROM implicit_feedback_signals
              WHERE emitted_at >= ${since}
                AND emitted_at < ${until}
              ORDER BY emitted_at DESC
              LIMIT ${lim}`,
        )) as unknown;
        const rows = toRows(result);
        const out: ImplicitSignalEntry[] = [];
        for (const row of rows) {
          const id = asString(row.id);
          const traceId = asString(row.trace_id);
          const tenantId = asString(row.tenant_id);
          const userId = asString(row.user_id);
          if (!id || !traceId || !tenantId || !userId) continue;
          out.push({
            id,
            traceId,
            agentActionId: asNullableString(row.agent_action_id),
            tenantId,
            userId,
            surface: asString(row.surface) ?? 'unknown',
            signalType: normaliseSignalType(row.signal_type),
            strength: asNumber(row.strength),
            emittedAt: asDateString(row.emitted_at),
          });
        }
        return out;
      } catch (error) {
        logger.warn('[consolidation-worker] ingest fetchImplicitSignals failed (schema may be pre-migration)', { value: asMessage(error) });
        return [];
      }
    },
    async fetchExplicitFeedback() {
      // No canonical thumbs/correction source mapped yet — see header.
      return [];
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
  /**
   * WRITE side of the SKILLS loop — the pgvector-backed `skill_registry`
   * writer. Stage 04-promote upserts a skill row for every recurring-
   * success trace cluster (≥3 traces, score ≥0.5, stable I/O signature).
   * Tenant scope is carried per-row by the cluster's `tenantId`
   * (`null` = global pool). Null in degraded mode (no DB).
   */
  readonly skillRegistry: SkillRegistryPort | null;
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
      skillRegistry: null,
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
  // WRITE side of the SKILLS loop — wire the pgvector-backed
  // `skill_registry` writer. `createSkillRegistryService(db).upsertSkill`
  // already matches the orchestrator's `SkillRegistryPort` shape exactly
  // (same args incl. the optional 1536-dim `embedding`, same
  // `{ id, created }` return), so no adapter wrapper is needed. The
  // service swallows hard DB failures internally (logs + returns a
  // benign result), so a registry outage degrades stage 04 to "no skills
  // promoted this tick" rather than crashing the worker.
  const skillRegistry = wrapSkillRegistry(db);

  return {
    entityConsolidator,
    reEmbedder,
    constitutionalCritic,
    skillRegistry,
  };
}

/**
 * Adapt the Drizzle-backed `skill_registry` service to the
 * orchestrator's `SkillRegistryPort`. The service's `upsertSkill` is
 * structurally identical to the port, but the service surfaces extra
 * methods (`searchByEmbedding`, `recordOutcome`, …) the promote stage
 * doesn't need — narrowing to the port keeps the orchestrator's
 * dependency surface minimal and duck-typed.
 */
function wrapSkillRegistry(db: DrizzleLikeClient): SkillRegistryPort {
  const svc = createSkillRegistryService(db as never);
  return {
    async upsertSkill(args) {
      return svc.upsertSkill(args);
    },
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

/**
 * Resolve a 1536-dim text embedder for stage 04-promote so promoted
 * skills carry a `description_embedding` and the kernel's READ-side
 * retriever (sovereign.ts) can find them by cosine similarity. The
 * central-intelligence `createOpenAiEmbedder` defaults to
 * `text-embedding-3-small` (1536 dims), matching `skill_registry`'s
 * `VECTOR(1536)` column AND the read-side embedder — keeping write/read
 * in the same vector space.
 *
 * Resolved via dynamic import of the central-intelligence dist (the same
 * sibling-package pattern `loadConstitutionalCritic` uses) so the worker
 * compiles + unit-tests without a build or an OpenAI key:
 *   - no `OPENAI_EMBEDDING_API_KEY` / `OPENAI_API_KEY` → returns null
 *     (stage 04 upserts skills WITHOUT a vector; still idempotent).
 *   - dist missing / factory throws → returns null (logged).
 */
async function loadSkillEmbedder(
  log?: WorkerLogger,
): Promise<ConsolidationEmbedder | null> {
  const apiKey =
    (process.env.OPENAI_EMBEDDING_API_KEY?.trim() ||
      process.env.OPENAI_API_KEY?.trim()) ??
    '';
  if (!apiKey) return null;
  try {
    const mod = (await import(
      '../../../packages/central-intelligence/dist/kernel/embedder.js'
    )) as {
      createOpenAiEmbedder?: (cfg: { apiKey: string }) => ConsolidationEmbedder;
    };
    if (typeof mod.createOpenAiEmbedder !== 'function') return null;
    return mod.createOpenAiEmbedder({ apiKey });
  } catch (error) {
    (log?.warn ?? (() => undefined))(
      { err: asMessage(error) },
      'consolidation-worker: skill embedder load failed — stage 04 will promote without embeddings',
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

  // Read-only client for the ledger attestor (it MUST never write ledger
  // rows). Prefer the gateway's read-replica accessor; alias the primary
  // `db` when no distinct replica is configured or the accessor is absent
  // (test-injected db, fresh checkout). Failure to resolve a readonly client
  // is non-fatal — the attestor falls back to the primary connection.
  const attestorDb = await resolveReadonlyDb(db, options);

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

  // Async per-upload OCR + full-text extraction poll. Runs on its own
  // interval (independent cadence from the consolidation loop). Each tick
  // resolves the REAL gateway adapters (Supabase download + SSRF-guarded OCR
  // adapter + BrainPort) via the sibling-service dynamic import and processes
  // documents whose `ingestion_status` has flipped to `ready`. A tick never
  // throws — failures degrade to a logged no-op so the supervisor stays up.
  const ocrPollMs = resolveOcrPollMs();
  let ocrTickInFlight = false;
  const runOcrTick = async (): Promise<void> => {
    if (ocrTickInFlight) return; // never overlap ticks
    ocrTickInFlight = true;
    try {
      await runOcrExtractionPollWithGatewayAdapters({
        db: db as unknown as OcrExtractionDb,
      });
    } catch (err) {
      logger.warn(
        { reason: err instanceof Error ? err.message : String(err) },
        'consolidation-worker: ocr-extraction poll tick failed',
      );
    } finally {
      ocrTickInFlight = false;
    }
  };
  const ocrPollHandle = setInterval(() => void runOcrTick(), ocrPollMs);
  ocrPollHandle.unref();
  logger.info({ ocrPollMs }, 'consolidation-worker: ocr-extraction poll started');

  // ───────────────────────────────────────────────────────────────────
  // 8-stage sleep-time consolidation orchestrator (WRITE side of the
  // SKILLS loop). Builds the B4 port bundle ONCE — now including the
  // pgvector-backed `skillRegistry` writer — plus the Drizzle ingest
  // sources and a 1536-dim skill embedder, then runs the full
  // 01→09 cascade on its own (daily) cadence. Stage 04-promote upserts a
  // `skill_registry` row for every recurring-success trace cluster, which
  // the kernel's READ-side retriever (sovereign.ts) then renders into its
  // "Available learned skills:" prompt fragment — closing the loop.
  //
  // A tick never throws: `runConsolidationOrchestrator` already absorbs
  // per-stage failures and the outer try/catch double-guards so the
  // supervisor stays up regardless. Ticks never overlap.
  const orchestratorIntervalMs = resolveOrchestratorIntervalMs();
  // A single 1536-dim embedder feeds BOTH the SKILLS-loop skill vectors
  // (stage 04-promote) AND the semantic-memory re-embed (stage 07). Both
  // columns are `VECTOR(1536)` / `text-embedding-3-small`, so the embedder
  // is dimensionally correct for each; off-dim vectors are dropped
  // defensively by each service. `ConsolidationEmbedder` and
  // `BulkReEmbedder` are the same structural port (`embed(text)`), so no
  // cast is needed when forwarding to the B4 builder.
  const skillEmbedder = await loadSkillEmbedder(logger);
  const b4Deps = await createOrchestratorB4Deps(db, {
    ...(skillEmbedder ? { embedder: skillEmbedder } : {}),
    logger,
  });
  const ingestSources = createReservoirIngestSources(db);
  const orchestratorDeps: ConsolidationOrchestratorDeps = {
    sources: ingestSources,
    logger: logger as StageLogger,
    ...(b4Deps.skillRegistry ? { skillRegistry: b4Deps.skillRegistry } : {}),
    ...(skillEmbedder ? { embedder: skillEmbedder } : {}),
    ...(b4Deps.entityConsolidator
      ? { entityConsolidator: b4Deps.entityConsolidator }
      : {}),
    ...(b4Deps.reEmbedder ? { reEmbedder: b4Deps.reEmbedder } : {}),
    ...(b4Deps.constitutionalCritic
      ? { constitutionalCritic: b4Deps.constitutionalCritic }
      : {}),
  };
  let orchestratorTickInFlight = false;
  const runOrchestratorTick = async (): Promise<void> => {
    if (orchestratorTickInFlight) return; // never overlap ticks
    orchestratorTickInFlight = true;
    try {
      const result = await runConsolidationOrchestrator(orchestratorDeps);
      logger.info(
        {
          tickId: result.delta.tickId,
          clustersInspected: result.clustersInspected,
          skillsPromoted: result.delta.skillsPromoted,
          promptPatches: result.delta.promptPatches,
          errors: result.errors.length,
        },
        'consolidation-worker: 8-stage orchestrator tick complete',
      );
    } catch (err) {
      logger.warn(
        { reason: asMessage(err) },
        'consolidation-worker: orchestrator tick failed',
      );
    } finally {
      orchestratorTickInFlight = false;
    }
  };
  const orchestratorHandle = setInterval(
    () => void runOrchestratorTick(),
    orchestratorIntervalMs,
  );
  orchestratorHandle.unref();
  logger.info(
    {
      orchestratorIntervalMs,
      skillRegistry: b4Deps.skillRegistry ? 'wired' : 'null',
      skillEmbedder: skillEmbedder ? 'wired' : 'null',
    },
    'consolidation-worker: 8-stage orchestrator started',
  );
  // Run one tick immediately at boot so the first sleep-time cascade does
  // not wait a full interval. Fire-and-forget — the tick is self-guarding.
  void runOrchestratorTick();

  // ───────────────────────────────────────────────────────────────────
  // Ledger / audit hash-chain attestor (LP-19). Read-only periodic job:
  // computes + signs a Merkle root over `ledger_entries` and
  // `ai_audit_chain`, publishes the signed checkpoint to a WORM sink
  // (in-memory always; env-gated S3 object-lock when LEDGER_ATTEST_BUCKET
  // is set). Built ONCE so the checkpoint store chains prevRoot across
  // ticks; fires hourly + once on boot.
  //
  // Fail-safe at three layers: `runAttestation` isolates per-chain
  // failures, `runLedgerAttestorCron` warns when failed>0, and the
  // tick wrapper try/catches so a source/DB error degrades to a logged
  // no-op — a cron error never crashes the supervisor. Ticks never
  // overlap.
  const attestorIntervalMs = resolveAttestorIntervalMs();
  const attestorDeps = await buildLedgerAttestorCronDeps(
    attestorDb as AttestorDbLike,
  );
  let attestorTickInFlight = false;
  const runAttestorTick = async (): Promise<void> => {
    if (attestorTickInFlight) return; // never overlap ticks
    attestorTickInFlight = true;
    try {
      await runLedgerAttestorCron(attestorDeps);
    } catch (err) {
      logger.warn(
        { reason: asMessage(err) },
        'consolidation-worker: ledger-attestor tick failed',
      );
    } finally {
      attestorTickInFlight = false;
    }
  };
  const attestorHandle = setInterval(
    () => void runAttestorTick(),
    attestorIntervalMs,
  );
  attestorHandle.unref();
  logger.info(
    { attestorIntervalMs, sinks: attestorDeps.sinks.length },
    'consolidation-worker: ledger-attestor started',
  );
  // Fire once on boot so a fresh deploy has an immediate signed checkpoint.
  void runAttestorTick();

  // SIGTERM-safe shutdown.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'consolidation-worker: shutdown requested');
    loop.stop();
    clearInterval(ocrPollHandle);
    clearInterval(orchestratorHandle);
    clearInterval(attestorHandle);
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

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const IMPLICIT_SIGNAL_TYPES = new Set<ImplicitSignalEntry['signalType']>([
  'copy',
  're-prompt',
  'edit-resubmit',
  'override',
  'abandonment',
  'time-to-resolution',
]);

function normaliseSignalType(v: unknown): ImplicitSignalEntry['signalType'] {
  if (
    typeof v === 'string' &&
    IMPLICIT_SIGNAL_TYPES.has(v as ImplicitSignalEntry['signalType'])
  ) {
    return v as ImplicitSignalEntry['signalType'];
  }
  // Unknown producer label — treat as a neutral outcome proxy rather than
  // dropping the row (stage 02 weights it as a weak signal).
  return 'time-to-resolution';
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Resolve a read-only Drizzle client for the ledger attestor. A test-injected
 * `options.db` is used as-is (one client serves both roles in tests).
 * Otherwise the gateway's `getDbReadonly()` is preferred (routes to the read
 * replica when DATABASE_URL_READONLY is distinct, else aliases the primary
 * pool). Any failure falls back to the already-resolved primary `db` — the
 * attestor query is read-only either way, so the replica is an optimisation,
 * not a correctness requirement.
 */
async function resolveReadonlyDb(
  primary: DrizzleLikeClient,
  options: MainOptions,
): Promise<DrizzleLikeClient> {
  if (options.db) return primary;
  try {
    const mod = (await import(
      // @ts-expect-error — sibling-service import resolved by pnpm symlink
      '../../api-gateway/dist/composition/db-client.js'
    )) as { getDbReadonly?: () => unknown };
    const ro = (mod.getDbReadonly?.() ?? null) as DrizzleLikeClient | null;
    return ro ?? primary;
  } catch (error) {
    logger.warn('[consolidation-worker] readonly db-client import failed — attestor uses primary connection', { value: asMessage(error) });
    return primary;
  }
}
