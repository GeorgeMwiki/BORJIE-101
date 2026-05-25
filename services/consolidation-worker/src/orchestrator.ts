/**
 * 8-stage sleep-time consolidation orchestrator (C5 Phase A).
 *
 * Replaces the legacy single-stub flow with a real cascade:
 *
 *   01-ingest        traces + implicit + explicit feedback
 *   02-cluster       group by intent / failure mode
 *   03-reflect       Haiku critic writes 1-paragraph reflection
 *   04-promote       success → skill_registry; failure → prompt-patch
 *   05-decay         existing memory-decay hook
 *   06-consolidate   Zep-style community merge (Phase B will wire)
 *   07-re-embed      bulk re-embed with current model version (Phase B)
 *   08-publish       emit brain.delta + Langfuse summary
 *
 * On error in any stage: log + continue. The worker NEVER crashes on
 * its own — the supervisor loop catches anything that escapes here.
 *
 * The orchestrator owns the OTel `consolidation.stage.N` spans (when
 * an OTel tracer is wired); each stage emits its own structured log
 * line so an operator can verify the cascade without OTel either.
 */

import { runIngestStage, type IngestSources } from './stages/01-ingest.js';
import { runClusterStage } from './stages/02-cluster.js';
import {
  runReflectStage,
  createStubCritic,
  type ConstitutionalCriticPort,
} from './stages/03-reflect.js';
import { runPromoteStage } from './stages/04-promote.js';
import { runDecayStage } from './stages/05-decay.js';
import {
  runConsolidateStage,
  type EntityConsolidatorPort,
} from './stages/06-consolidate.js';
import {
  runReEmbedStage,
  type ReEmbedPort,
} from './stages/07-re-embed.js';
import { runPublishStage } from './stages/08-publish.js';
import { runWeeklyPromptCompileStage } from './stages/09-weekly-prompt-compile.js';
import type {
  BrainDelta,
  BrainDeltaPublisher,
  ConsolidationEmbedder,
  ReflectionCritic,
  SemanticDecayPort,
  SkillRegistryPort,
  StageLogger,
  TraceCluster,
} from './stages/types.js';
import {
  createNoopTracer,
  type StageSpanRunner,
  type StageTracer,
} from './observability/otel-tracer.js';

export interface ConsolidationOrchestratorDeps {
  readonly sources: IngestSources;
  readonly logger: StageLogger;
  readonly skillRegistry?: SkillRegistryPort;
  readonly embedder?: ConsolidationEmbedder;
  readonly critic?: ReflectionCritic;
  readonly semanticDecay?: SemanticDecayPort;
  readonly entityConsolidator?: EntityConsolidatorPort;
  readonly reEmbedder?: ReEmbedPort;
  /**
   * Optional RLAIF constitutional critic — B4 Phase B. When supplied,
   * stage 03 (reflect) scores each cluster reflection against the
   * BORJIE constitution (TZ Rental Act, GDPR/PDPA, currency-chain,
   * inviolable IP) so the optimisation loop has a principled label
   * even without humans in the loop. When omitted, stage 03 still
   * runs — it just skips the constitutional verdict.
   */
  readonly constitutionalCritic?: ConstitutionalCriticPort;
  readonly publisher?: BrainDeltaPublisher;
  readonly windowMs?: number;
  readonly decayPerDay?: number;
  readonly now?: () => Date;
  /**
   * Optional override of the entire cluster step. When supplied
   * (composition root wires a real embedding-based clusterer), the
   * orchestrator forwards it through.
   */
  readonly clusterer?: (bundle: ReturnType<typeof noop>) => Promise<
    ReadonlyArray<TraceCluster>
  >;
  /**
   * Optional OTel tracer. When supplied, every stage runs inside a
   * `consolidation.stage.N` active span and the whole tick is wrapped
   * in `consolidation.tick`. Defaults to a no-op tracer.
   */
  readonly tracer?: StageTracer;
  /**
   * Optional weekday provider — orchestrator runs stage 09 (DSPy
   * GEPA prompt recompile) only when `weekday === 0` (Sunday).
   * Production injects `() => new Date().getUTCDay()`; tests pass a
   * fixed function. Default: read `now().getUTCDay()` if `now` is
   * supplied, else the real Date.
   */
  readonly weekday?: () => number;
  /**
   * Optional weekly stage hook — runs the DSPy GEPA prompt recompile
   * stage when `weekday === 0`. Composition root wires the real GEPA
   * optimiser; tests pass a stub. When omitted, the stage is a no-op.
   */
  readonly weeklyPromptCompiler?: () => Promise<{
    readonly promptsCompiled: number;
    readonly promotedCount: number;
  }>;
}

// Hidden helper so the optional override type compiles without an
// import cycle on `IngestBundle`. The real type is in stages/types.ts.
function noop(): unknown {
  return undefined;
}

export interface ConsolidationTickResult {
  readonly delta: BrainDelta;
  readonly clustersInspected: number;
  readonly errors: ReadonlyArray<string>;
}

export async function runConsolidationOrchestrator(
  deps: ConsolidationOrchestratorDeps,
): Promise<ConsolidationTickResult> {
  const logger = deps.logger;
  const errors: string[] = [];
  const tracer = deps.tracer ?? createNoopTracer();
  const tickId = `tick_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;

  return tracer.startTick(tickId, async (runStage) => {
    // STAGE 01 — ingest
    const bundle = await safeStage(
      logger,
      runStage,
      '01-ingest',
      () =>
        runIngestStage({
          sources: deps.sources,
          logger,
          ...(deps.now ? { now: deps.now } : {}),
          ...(deps.windowMs !== undefined ? { windowMs: deps.windowMs } : {}),
        }),
      {
        windowStart: new Date(0).toISOString(),
        windowEnd: new Date(0).toISOString(),
        traces: [],
        implicitSignals: [],
        explicitFeedback: [],
      },
      errors,
    );

    // STAGE 02 — cluster
    const clusters = await safeStage(
      logger,
      runStage,
      '02-cluster',
      () =>
        runClusterStage({
          bundle: bundle as never,
          logger,
          ...(deps.clusterer
            ? { clusterer: deps.clusterer as never }
            : {}),
        }),
      [] as ReadonlyArray<TraceCluster>,
      errors,
    );

    // STAGE 03 — reflect
    const reflections = await safeStage(
      logger,
      runStage,
      '03-reflect',
      () =>
        runReflectStage({
          clusters,
          critic: deps.critic ?? createStubCritic(),
          logger,
          ...(deps.constitutionalCritic
            ? { constitutionalCritic: deps.constitutionalCritic }
            : {}),
        }),
      [],
      errors,
    );

    // STAGE 04 — promote
    const promote = await safeStage(
      logger,
      runStage,
      '04-promote',
      () =>
        runPromoteStage({
          clusters,
          reflections,
          logger,
          ...(deps.skillRegistry ? { skillRegistry: deps.skillRegistry } : {}),
          ...(deps.embedder ? { embedder: deps.embedder } : {}),
        }),
      { decisions: [], skillsPromoted: 0, promptPatches: 0 },
      errors,
    );

    // Tenants touched in this batch (for decay / consolidate / re-embed).
    const tenantIds = uniqueTenants(clusters.map((c) => c.tenantId));

    // STAGE 05 — decay
    const decay = await safeStage(
      logger,
      runStage,
      '05-decay',
      () =>
        runDecayStage({
          tenantIds,
          logger,
          ...(deps.semanticDecay ? { semantic: deps.semanticDecay } : {}),
          ...(deps.decayPerDay !== undefined
            ? { decayPerDay: deps.decayPerDay }
            : {}),
        }),
      { factsDecayed: 0, perTenant: {} },
      errors,
    );

    // STAGE 06 — consolidate
    const consolidate = await safeStage(
      logger,
      runStage,
      '06-consolidate',
      () =>
        runConsolidateStage({
          tenantIds,
          logger,
          ...(deps.entityConsolidator
            ? { consolidator: deps.entityConsolidator }
            : {}),
        }),
      { entitiesMerged: 0, perTenant: {} },
      errors,
    );

    // STAGE 07 — re-embed
    const reembed = await safeStage(
      logger,
      runStage,
      '07-re-embed',
      () =>
        runReEmbedStage({
          tenantIds,
          logger,
          ...(deps.reEmbedder ? { reEmbedder: deps.reEmbedder } : {}),
        }),
      { factsReEmbedded: 0, perTenant: {} },
      errors,
    );

    // STAGE 08 — publish
    const delta = await safeStage(
      logger,
      runStage,
      '08-publish',
      () =>
        runPublishStage({
          logger,
          ...(deps.publisher ? { publisher: deps.publisher } : {}),
          windowStart: (bundle as { windowStart: string }).windowStart,
          windowEnd: (bundle as { windowEnd: string }).windowEnd,
          skillsPromoted: promote.skillsPromoted,
          promptPatches: promote.promptPatches,
          factsDecayed: decay.factsDecayed,
          entitiesMerged: consolidate.entitiesMerged,
          factsReEmbedded: reembed.factsReEmbedded,
          clustersInspected: clusters.length,
        }),
      {
        tickId,
        windowStart: new Date(0).toISOString(),
        windowEnd: new Date(0).toISOString(),
        skillsPromoted: 0,
        promptPatches: 0,
        factsDecayed: 0,
        entitiesMerged: 0,
        factsReEmbedded: 0,
        clustersInspected: 0,
      } satisfies BrainDelta,
      errors,
    );

    // STAGE 09 — weekly DSPy GEPA prompt recompile (Sundays only).
    // Out-of-band from the brain delta — the weekly result is a
    // separate event the orchestrator emits via the logger.
    const weekday =
      deps.weekday?.() ??
      (deps.now ? deps.now().getUTCDay() : new Date().getUTCDay());
    if (weekday === 0 && deps.weeklyPromptCompiler) {
      await safeStage(
        logger,
        runStage,
        '09-weekly-prompt-compile',
        () =>
          runWeeklyPromptCompileStage({
            logger,
            compile: deps.weeklyPromptCompiler!,
          }),
        { promptsCompiled: 0, promotedCount: 0 },
        errors,
      );
    }

    return {
      delta,
      clustersInspected: clusters.length,
      errors,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

async function safeStage<T>(
  logger: StageLogger,
  runStage: StageSpanRunner,
  stage: string,
  fn: () => Promise<T>,
  fallback: T,
  errors: string[],
): Promise<T> {
  try {
    return await runStage(stage, fn);
  } catch (error) {
    const msg = asMessage(error);
    logger.warn(
      { stage, err: msg },
      `stage ${stage} threw — falling through with fallback`,
    );
    errors.push(`${stage}:${msg}`);
    return fallback;
  }
}

function uniqueTenants(
  ids: ReadonlyArray<string | null>,
): ReadonlyArray<string | null> {
  const seen = new Set<string>();
  const out: Array<string | null> = [];
  for (const id of ids) {
    const k = id ?? '__null__';
    if (!seen.has(k)) {
      seen.add(k);
      out.push(id);
    }
  }
  return out;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
