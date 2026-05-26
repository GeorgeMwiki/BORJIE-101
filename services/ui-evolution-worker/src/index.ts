/**
 * `@borjie/ui-evolution-worker` — composition root.
 *
 * Layer 4 of the Anticipatory UX architecture. See
 * `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md` §4 + §5.
 *
 * Boot sequence:
 *
 *   1. Load + validate env (`loadConfig`).
 *   2. If DATABASE_URL is missing, log + exit 0 (the supervisor's
 *      degraded mode — many cron-style workers coexist in one pod;
 *      one misconfigured worker should not pull the platform down).
 *   3. Open a postgres-js client; build the three repositories.
 *   4. Wire the audit chain store, the LLM client (when not disabled),
 *      and the lock-candidate ledger.
 *   5. Hand the deps bundle to `scheduleNightlySweep` (long-lived
 *      mode) OR `runNightlySweep` directly (one-shot CronJob mode,
 *      gated by `UI_EVO_ONESHOT=1`).
 *   6. Install SIGTERM / SIGINT handlers that stop the scheduler
 *      cleanly.
 *
 * This module exports the public surface that the supervisor and the
 * tests need; the body is small + pure orchestration.
 */

import postgres from 'postgres';

import { loadConfig, isOperational, type WorkerConfig } from './config.js';
import type { WorkerLogger } from './types.js';
import { createRecipeRepository, type RecipeDb } from './storage/recipe-repository.js';
import { createTelemetryRepository } from './storage/telemetry-repository.js';
import { createProposalRepository } from './storage/proposal-repository.js';
import {
  createAuditEmitter,
  createInMemoryChainStore,
} from './audit/audit-emit.js';
import type { LockCandidateLedger } from './decisions/lock-decision.js';
import {
  runNightlySweep,
  scheduleNightlySweep,
  type SweepDeps,
  type CronOptions,
  type CronHandle,
} from './cron/nightly-aggregator-cron.js';
import {
  buildHealthSnapshot,
  type HealthSnapshot,
  type HealthState,
} from './routes/health.js';
import {
  createLogNotificationSink,
} from './approval/proposal-emitter.js';

// ---------------------------------------------------------------------------
// Re-exports — what the supervisor + tests consume.
// ---------------------------------------------------------------------------

export {
  loadConfig,
  isOperational,
  type WorkerConfig,
} from './config.js';
export type { WorkerLogger } from './types.js';
export {
  runNightlySweep,
  scheduleNightlySweep,
  type SweepDeps,
  type CronOptions,
  type CronHandle,
} from './cron/nightly-aggregator-cron.js';
export {
  createRecipeRepository,
  type RecipeRepository,
  type RecipeDb,
} from './storage/recipe-repository.js';
export {
  createTelemetryRepository,
  type TelemetryRepository,
} from './storage/telemetry-repository.js';
export {
  createProposalRepository,
  type ProposalRepository,
} from './storage/proposal-repository.js';
export {
  emitProposal,
  createLogNotificationSink,
  type NotificationSink,
  type EmitProposalArgs,
} from './approval/proposal-emitter.js';
export {
  approveProposal,
  rejectProposal,
  applyLock,
  markLockCandidate,
  type PromotionOutcome,
  type ApproveProposalArgs,
  type RejectProposalArgs,
  type ApplyLockArgs,
} from './approval/promotion.js';
export {
  createAuditEmitter,
  createInMemoryChainStore,
  type AuditEmitter,
  type AuditKind,
  type ChainStore,
} from './audit/audit-emit.js';
export {
  decideLock,
  type LockCandidateLedger,
  type LockDecisionArgs,
} from './decisions/lock-decision.js';
export {
  decideImprove,
  type PendingProposalProbe,
  type RecipeLockProbe,
  type ImproveDecisionArgs,
} from './decisions/improve-decision.js';
export {
  generateProposal,
  generateStubProposal,
  generateLlmProposal,
  type GenerateProposalArgs,
  type GeneratedProposal,
} from './decisions/proposal-generator.js';
export {
  validateProposal,
  type ValidationResult,
  type ValidateProposalArgs,
} from './decisions/proposal-validator.js';
export {
  computeRecipeMetrics,
  type ComputeMetricsArgs,
} from './aggregator/metric-computer.js';
export {
  scoreRecipe,
  computeScore,
  LOCK_COMPLETION_MIN,
  LOCK_FIELD_ERROR_MAX,
  LOCK_FIELD_ABANDONMENT_MAX,
  IMPROVE_COMPLETION_MAX,
  IMPROVE_FIELD_ERROR_MIN,
  IMPROVE_TOOLTIP_HIT_MIN,
  SCORE_WEIGHT_COMPLETION,
  SCORE_WEIGHT_ERROR,
  SCORE_WEIGHT_ABANDONMENT,
} from './aggregator/fitness-scorer.js';
export {
  aggregateRecipe,
  makeWindow,
  type TelemetryReader,
  type AggregateRecipeArgs,
  type RecipeAggregation,
  type WindowSpec,
} from './aggregator/daily-aggregator.js';
export {
  buildHealthSnapshot,
  handleHealthRequest,
  type HealthSnapshot,
  type HealthState,
} from './routes/health.js';

// ---------------------------------------------------------------------------
// Console logger — minimal fallback when an external one isn't wired.
// ---------------------------------------------------------------------------

function consoleLogger(serviceName: string): WorkerLogger {
  return {
    info: (obj, msg) => process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level: 'info', service: serviceName, msg: msg ?? '', ...obj })}\n`,
    ),
    warn: (obj, msg) => process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level: 'warn', service: serviceName, msg: msg ?? '', ...obj })}\n`,
    ),
    error: (obj, msg) => process.stderr.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level: 'error', service: serviceName, msg: msg ?? '', ...obj })}\n`,
    ),
  };
}

// ---------------------------------------------------------------------------
// postgres-js → RecipeDb adapter
// ---------------------------------------------------------------------------

function postgresToRecipeDb(sql: ReturnType<typeof postgres>): RecipeDb {
  return {
    async query<T = unknown>(
      query: string,
      params: ReadonlyArray<unknown> = [],
    ): Promise<ReadonlyArray<T>> {
      // postgres-js's `sql.unsafe` accepts a params array typed against
      // the connection's generic. We're a generic adapter, so cast at
      // the boundary — the caller's repository validates row shape.
      const result = await (sql as unknown as {
        unsafe(query: string, params?: unknown[]): Promise<unknown>;
      }).unsafe(query, [...params]);
      return result as unknown as ReadonlyArray<T>;
    },
  };
}

// ---------------------------------------------------------------------------
// Lock-candidate ledger — in-process default; production swaps for a
// Redis-backed ledger (or a sibling `tab_recipes_lock_candidates` row).
// ---------------------------------------------------------------------------

function createInProcessLedger(): LockCandidateLedger {
  const state = new Map<string, string>();
  const key = (id: string, version: number) => `${id}:${version}`;
  return {
    async readFirstCandidateAt({ tabRecipeId, tabRecipeVersion }) {
      return state.get(key(tabRecipeId, tabRecipeVersion)) ?? null;
    },
    async writeFirstCandidateAt({ tabRecipeId, tabRecipeVersion, atIso }) {
      const k = key(tabRecipeId, tabRecipeVersion);
      if (!state.has(k)) {
        state.set(k, atIso);
      }
    },
    async clearCandidacy({ tabRecipeId, tabRecipeVersion }) {
      state.delete(key(tabRecipeId, tabRecipeVersion));
    },
  };
}

// ---------------------------------------------------------------------------
// Default deps wire — when caller doesn't supply overrides.
// ---------------------------------------------------------------------------

export interface BuildDepsOptions {
  readonly config: WorkerConfig;
  readonly logger?: WorkerLogger;
  /** Override the schema fetcher (test seam). */
  readonly fetchCurrentSchema?: SweepDeps['fetchCurrentSchema'];
  readonly fetchKnownCitations?: SweepDeps['fetchKnownCitations'];
  readonly fetchTenantsForRecipe?: SweepDeps['fetchTenantsForRecipe'];
  /** Override the postgres client (test seam). */
  readonly db?: RecipeDb | null;
}

export async function buildSweepDeps(
  options: BuildDepsOptions,
): Promise<SweepDeps | null> {
  if (!isOperational(options.config)) {
    options.logger?.warn?.(
      {},
      'ui-evolution-worker: DATABASE_URL not set — supervisor is a no-op',
    );
    return null;
  }
  const logger = options.logger ?? consoleLogger(options.config.UI_EVO_SERVICE_NAME);

  let db: RecipeDb | null = options.db ?? null;
  if (!db) {
    const url = options.config.DATABASE_URL;
    if (!url) return null;
    const sql = postgres(url, {
      onnotice: () => undefined,
    });
    db = postgresToRecipeDb(sql);
  }

  const recipes = createRecipeRepository(db);
  const telemetry = createTelemetryRepository(db);
  const proposals = createProposalRepository(db);

  const audit = createAuditEmitter({
    store: createInMemoryChainStore(),
    ...(options.config.UI_EVO_AUDIT_SECRET_ID
      ? { secretId: options.config.UI_EVO_AUDIT_SECRET_ID }
      : {}),
    ...(options.config.UI_EVO_AUDIT_SECRET_VALUE
      ? { secretValue: options.config.UI_EVO_AUDIT_SECRET_VALUE }
      : {}),
  });

  const fetchCurrentSchema =
    options.fetchCurrentSchema ??
    (async () => null);
  const fetchKnownCitations =
    options.fetchKnownCitations ?? (async () => []);
  const fetchTenantsForRecipe =
    options.fetchTenantsForRecipe ?? (async () => []);

  const sink = createLogNotificationSink((line, data) =>
    logger.info?.({ line, ...data }, 'notification'),
  );

  return {
    recipes,
    telemetry,
    proposals,
    notifications: sink,
    audit,
    ledger: createInProcessLedger(),
    fetchCurrentSchema,
    fetchKnownCitations,
    fetchTenantsForRecipe,
    llm: {
      disabled: Boolean(options.config.UI_EVO_DISABLE_LLM),
    },
    logger,
  };
}

// ---------------------------------------------------------------------------
// Main — launched by `node dist/index.js`.
// ---------------------------------------------------------------------------

export interface LaunchResult {
  readonly handle: CronHandle | null;
  readonly health: () => HealthSnapshot;
}

export async function launch(
  config: WorkerConfig = loadConfig(),
  options: { readonly logger?: WorkerLogger } = {},
): Promise<LaunchResult> {
  const logger = options.logger ?? consoleLogger(config.UI_EVO_SERVICE_NAME);
  const deps = await buildSweepDeps({ config, logger });
  const cronOptions: CronOptions = {
    shortWindowDays: config.UI_EVO_SHORT_WINDOW_DAYS,
    longWindowDays: config.UI_EVO_LONG_WINDOW_DAYS,
    sustainDays: config.UI_EVO_LOCK_SUSTAIN_DAYS,
    concurrency: config.UI_EVO_CONCURRENCY,
  };

  const healthState: HealthState = {
    lastSummary: null,
    schedule: config.UI_EVO_CRON,
    operational: deps !== null,
  };
  const health = () =>
    buildHealthSnapshot({ state: healthState, nowMs: Date.now() });

  if (!deps) {
    return { handle: null, health };
  }

  if (config.UI_EVO_ONESHOT) {
    const summary = await runNightlySweep(deps, cronOptions);
    healthState.lastSummary = summary;
    logger.info?.(
      {
        recipesProcessed: summary.recipesProcessed,
        proposalsEmitted: summary.proposalsEmitted,
        locksApplied: summary.locksApplied,
        errored: summary.errored,
      },
      'ui-evolution-worker: oneshot complete',
    );
    return { handle: null, health };
  }

  const handle = scheduleNightlySweep({
    cronExpression: config.UI_EVO_CRON,
    deps,
    options: cronOptions,
    onTick: (summary) => {
      healthState.lastSummary = summary;
    },
  });
  installShutdownHandlers(handle, logger);
  return { handle, health };
}

function installShutdownHandlers(handle: CronHandle, logger: WorkerLogger): void {
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info?.({ signal }, 'ui-evolution-worker: shutdown requested');
    handle.stop();
    setTimeout(() => process.exit(0), 50).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

// ---------------------------------------------------------------------------
// CLI guard
// ---------------------------------------------------------------------------

const isDirect =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /index(\.js|\.ts)?$/.test(process.argv[1]) &&
  process.argv[1].includes('ui-evolution-worker');

if (isDirect) {
  launch().catch((err: unknown) => {
    process.stderr.write(
      `[ui-evolution-worker] fatal ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  });
}
