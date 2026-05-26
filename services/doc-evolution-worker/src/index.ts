/**
 * doc-evolution-worker — entrypoint + lifecycle.
 *
 * Layer 4 of Document Composition (Wave 17D). At launch:
 *   - Loads + validates env config.
 *   - Schedules the nightly aggregation (03:00 UTC by default).
 *   - Starts the Tier-2 queue watcher poll loop (default 60s).
 *
 * Both subsystems are wired against injected ports. The composition
 * root (production) wires a postgres-js Sql connection, an ioredis
 * client, the brain-llm-router cost-cascade LLM port, and the real
 * notification adapter. Tests wire stubs.
 *
 * Run modes:
 *   - one-shot (DOC_EVO_ONE_SHOT=true): runs aggregation once then exits.
 *     The Kubernetes CronJob pattern from the brain-evolution-worker.
 *   - long-running: schedules both cron + tier2-queue, returns the
 *     handles so the parent can clean up on SIGTERM.
 */

import type { WorkerConfig } from './config.js';
import { runNightlyAggregation } from './aggregator/nightly-aggregator.js';
import type {
  NightlyAggregatorDeps,
  NightlyAggregatorConfig,
} from './aggregator/nightly-aggregator.js';
import {
  scheduleNightlyAggregator,
  type CronHandle,
} from './cron/nightly-aggregator-cron.js';
import {
  tickTier2Queue,
  type Tier2WatcherDeps,
} from './approval/tier2-queue.js';
import { evaluateHealth, type HealthSnapshot } from './routes/health.js';
import type { NightlyAggregationSummary, WorkerLogger } from './types.js';

export type { WorkerConfig } from './config.js';
export type {
  RecipeFitnessStats,
  RecipeFitnessScore,
  LockDecision,
  ImproveDecision,
  ProposedDiff,
  SectionEdit,
  Tier2ApprovalCard,
  NightlyAggregationSummary,
  WorkerLogger,
  DocumentClass,
  DocumentRecipeRow,
  DocumentArtifactRow,
  DocFeedbackEventRow,
  DocEvolutionProposalRow,
} from './types.js';

export {
  computeRecipeStats,
} from './aggregator/metric-computer.js';
export {
  scoreFitness,
  W_ACCEPTANCE,
  W_REVISION,
  W_REGULATOR,
} from './aggregator/fitness-scorer.js';
export { decideLock } from './decisions/lock-decision.js';
export {
  decideImprove,
  targetedSectionsForImprove,
} from './decisions/improve-decision.js';
export {
  generateProposal,
  buildPrompt,
  type ProposalLlmPort,
  type FeedbackNarrative,
} from './decisions/proposal-generator.js';
export {
  validateProposal,
  lintProposalText,
} from './decisions/proposal-validator.js';
export {
  emitProposal,
  type NotificationSink,
  type ProposalNotification,
} from './approval/proposal-emitter.js';
export {
  promoteProposal,
  rejectProposal,
} from './approval/promotion.js';
export {
  tickTier2Queue,
  approveTier2Artifact,
  rejectTier2Artifact,
  InMemoryQueueCursor,
  TIER2_DOCUMENT_CLASSES,
  type QueueCursor,
  type Tier2QueueSink,
  type Tier2WatcherDeps,
  type Tier2WatcherResult,
} from './approval/tier2-queue.js';
export {
  emitAuditEntry,
  type AuditEventKind,
} from './audit/audit-emit.js';
export {
  evaluateHealth,
  livenessBody,
  readinessBody,
  type HealthSnapshot,
  type HealthStatus,
} from './routes/health.js';
export { loadConfig } from './config.js';
export {
  runNightlyAggregation,
  type NightlyAggregatorDeps,
  type NightlyAggregatorConfig,
} from './aggregator/nightly-aggregator.js';
export {
  scheduleNightlyAggregator,
  type CronHandle,
  type ScheduleArgs,
} from './cron/nightly-aggregator-cron.js';
export {
  createRecipeRepository,
  type RecipeRepository,
  type SqlPort,
} from './storage/recipe-repository.js';
export {
  createArtifactRepository,
  type ArtifactRepository,
} from './storage/artifact-repository.js';
export {
  createFeedbackRepository,
  type FeedbackRepository,
} from './storage/feedback-repository.js';
export {
  createProposalRepository,
  type ProposalRepository,
  type InsertProposalArgs,
} from './storage/proposal-repository.js';

// ---------------------------------------------------------------------------
// Lifecycle.
// ---------------------------------------------------------------------------

export interface LaunchDeps {
  readonly aggregator: NightlyAggregatorDeps;
  readonly tier2: Tier2WatcherDeps;
  readonly logger?: WorkerLogger;
}

export interface LaunchResult {
  readonly cron: CronHandle | null;
  readonly tier2QueueTimer: ReturnType<typeof setInterval> | null;
  readonly snapshot: () => HealthSnapshot;
  /** Gracefully stop all background work. */
  stop(): Promise<void>;
}

export async function launchDocEvolutionWorker(
  config: WorkerConfig,
  deps: LaunchDeps,
): Promise<LaunchResult> {
  const logger = deps.logger ?? deps.aggregator.logger;
  let lastAggregationAt: string | null = null;
  let tier2QueuePolling = false;

  const aggregatorConfig: NightlyAggregatorConfig = {
    rolling_window_days: config.ROLLING_WINDOW_DAYS,
    lock_sustained_days: config.LOCK_SUSTAINED_DAYS,
    regulator_flag_lookback_days: config.REGULATOR_FLAG_LOOKBACK_DAYS,
    lock_acceptance_threshold: config.LOCK_ACCEPTANCE_THRESHOLD,
    lock_revision_ceiling: config.LOCK_REVISION_CEILING,
    improve_acceptance_ceiling: config.IMPROVE_ACCEPTANCE_CEILING,
    improve_section_revision_threshold:
      config.IMPROVE_SECTION_REVISION_THRESHOLD,
  };

  // One-shot mode: run once and exit.
  if (config.ONE_SHOT) {
    const summary = await runNightlyAggregation(deps.aggregator, aggregatorConfig);
    lastAggregationAt = summary.window_end_iso;
    logger?.info?.(
      {
        recipes_scanned: summary.recipes_scanned,
        lock_decisions: summary.lock_decisions,
        improve_decisions: summary.improve_decisions,
      },
      'doc-evolution-worker: one-shot aggregation complete',
    );
    return {
      cron: null,
      tier2QueueTimer: null,
      snapshot: () =>
        evaluateHealth({
          getLastAggregationAt: () => lastAggregationAt,
          getTier2QueuePolling: () => false,
          now: () => new Date(),
          staleness_threshold_ms: 36 * 60 * 60 * 1000,
        }),
      async stop() {
        // nothing to clean up.
      },
    };
  }

  // Long-running mode.
  let cronHandle: CronHandle | null = null;
  if (config.ENABLE_CRON) {
    cronHandle = scheduleNightlyAggregator({
      cronExpr: config.NIGHTLY_CRON_EXPR,
      deps: deps.aggregator,
      config: aggregatorConfig,
      onComplete: (summary: NightlyAggregationSummary) => {
        lastAggregationAt = summary.window_end_iso;
      },
      ...(logger ? { logger } : {}),
    });
  }

  let tier2QueueTimer: ReturnType<typeof setInterval> | null = null;
  if (config.ENABLE_TIER2_QUEUE) {
    tier2QueuePolling = true;
    tier2QueueTimer = setInterval(() => {
      tickTier2Queue(deps.tier2)
        .then((res) => {
          if (res.cards_emitted > 0) {
            logger?.info?.(
              { cards_emitted: res.cards_emitted },
              'doc-evolution-worker: tier-2 queue tick',
            );
          }
        })
        .catch((err: unknown) => {
          logger?.warn?.(
            { err: err instanceof Error ? err.message : String(err) },
            'doc-evolution-worker: tier-2 queue tick failed',
          );
        });
    }, config.TIER2_QUEUE_POLL_MS);
  }

  return {
    cron: cronHandle,
    tier2QueueTimer,
    snapshot: () =>
      evaluateHealth({
        getLastAggregationAt: () => lastAggregationAt,
        getTier2QueuePolling: () => tier2QueuePolling,
        now: () => new Date(),
        staleness_threshold_ms: 36 * 60 * 60 * 1000,
      }),
    async stop() {
      if (cronHandle !== null) {
        cronHandle.stop();
      }
      if (tier2QueueTimer !== null) {
        clearInterval(tier2QueueTimer);
        tier2QueuePolling = false;
      }
    },
  };
}

export { loadConfig as loadDocEvolutionConfig } from './config.js';
