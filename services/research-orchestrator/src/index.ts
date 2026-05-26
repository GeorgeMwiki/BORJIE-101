/**
 * @borjie/research-orchestrator — entrypoint + public re-exports.
 *
 * Deep Research engine — Planner + Executor + Scorer + Synthesizer
 * pipeline for the 5 research modes per DEEP_RESEARCH_SPEC.
 *
 * Launch shape:
 *
 *   1. Validate env via `loadConfig`. Bail fast on missing critical
 *      vars; tolerate missing API keys (those tools become no-ops).
 *   2. Stand up a tiny HTTP server on PORT (default 4011) for the
 *      `/health` endpoint Kubernetes liveness probes hit.
 *   3. Register the daily-briefing cron (one process-level minute-
 *      cadence cron sweeps all active tenants and fires per their
 *      timezone) + the continuous-watch sweep (every 60 s polls due
 *      watches).
 *   4. Block the process. The five mode handlers (Reactive Query,
 *      Anticipatory Sweep, Daily Briefing, Deep Dive, Continuous
 *      Watch) are exported for in-process callers (api-gateway, tests).
 *   5. On SIGTERM / SIGINT: stop the crons, finish in-flight steps,
 *      close the HTTP server, exit cleanly.
 *
 * The composition root (DB pool, Redis client, LLM router wiring,
 * tool registry) is wired in `bootstrap` — but kept OPTIONAL so unit
 * tests can launch a minimal "logger-only" worker.
 *
 * @module research-orchestrator
 */

import { createLogger } from '@borjie/observability';
import { createHealthServer, type HealthServerHandle } from './routes/health.js';
import { loadConfig, modeBudgetsFromConfig, type AppConfig } from './config.js';
import type { OrchestratorLogger } from './types.js';

// Re-export the 5 mode handlers for in-process invocation (api-gateway,
// chat workers) + tests.
export { runReactiveQuery } from './modes/reactive-query.js';
export { runAnticipatorySweep } from './modes/anticipatory-sweep.js';
export { runDailyBriefing } from './modes/daily-briefing.js';
export { runDeepDive } from './modes/deep-dive.js';
export { runContinuousWatch } from './modes/continuous-watch.js';

// Re-export cron starters.
export { startDailyBriefingCron, tenantLocalParts } from './cron/daily-briefing-cron.js';
export { startContinuousWatchCron } from './cron/continuous-watch-cron.js';

// Re-export core types + ports.
export * from './types.js';
export { loadConfig, modeBudgetsFromConfig } from './config.js';
export {
  createBudgetGate,
  createCostTracker,
  createOwnerConfirmGate,
  NEVER_GATES,
  type BudgetGate,
} from './budgets/budget-gate.js';
export { buildPlan, BUILT_IN_TEMPLATES } from './planner/plan-builder.js';
export { validatePlan } from './planner/plan-validator.js';
export { runStep, type ToolRegistry } from './executor/step-runner.js';
export { runPlan } from './executor/plan-runner.js';
export {
  checkpointAfterStep,
  createInMemoryCheckpointer,
  type StepCheckpointer,
} from './executor/long-running-checkpoint.js';
export { rescoreArtifacts } from './scorer/artifact-scorer.js';
export { crossReference, buildDisagreements } from './scorer/cross-reference.js';
export { synthesizeAnswer } from './synthesizer/answer-synthesizer.js';
export { calibrateConfidence } from './synthesizer/confidence-calibrator.js';
export { detectDisagreements } from './synthesizer/disagreement-detector.js';
export {
  buildAuditPayload,
  emitToChain,
  type AuditChainPersistencePort,
} from './audit/audit-emit.js';
export {
  createInMemoryPlanRepository,
  createSqlPlanRepository,
  type PlanRepository,
} from './storage/plan-repository.js';
export {
  createInMemoryStepRepository,
  createSqlStepRepository,
  type StepRepository,
} from './storage/step-repository.js';
export {
  createInMemoryArtifactRepository,
  createSqlArtifactRepository,
  type ArtifactRepository,
} from './storage/artifact-repository.js';
export {
  createInMemoryResultRepository,
  createSqlResultRepository,
  type ResultRepository,
} from './storage/result-repository.js';
export {
  createInMemorySessionRepository,
  createSqlSessionRepository,
  type SessionRepository,
  type SessionRow,
  type SessionState,
} from './storage/session-repository.js';
export {
  createInMemoryWatchRepository,
  createSqlWatchRepository,
  type WatchRepository,
} from './storage/watch-repository.js';
export type {
  ModeRunDeps,
  ModeRepositories,
  ModeBudgets,
  AuditEmitterPort,
  NotificationPort,
  BriefingSink,
} from './modes/shared.js';
export type { AppConfig } from './config.js';

// ─────────────────────────────────────────────────────────────────────────
// Launch shape — `main()` wires the composition root + health server +
// crons. Composition root injection is OPTIONAL (test harnesses use
// the in-memory repos directly).
// ─────────────────────────────────────────────────────────────────────────

export interface MainOptions {
  /** Override config (tests). */
  readonly config?: Partial<AppConfig>;
  readonly logger?: OrchestratorLogger;
  /**
   * When supplied, the launcher will register the daily-briefing cron
   * with this dep bag + tenant lister.
   */
  readonly briefingCron?: {
    readonly deps: import('./modes/shared.js').ModeRunDeps;
    readonly tenants: import('./cron/daily-briefing-cron.js').BriefingTenantLister;
  };
  /**
   * When supplied, the launcher will register the continuous-watch
   * sweep with this dep bag.
   */
  readonly watchCron?: {
    readonly deps: import('./modes/shared.js').ModeRunDeps;
    readonly watches: import('./storage/watch-repository.js').WatchRepository;
  };
}

export interface MainHandle {
  readonly config: AppConfig;
  readonly logger: OrchestratorLogger;
  readonly server: HealthServerHandle;
  stop(): Promise<void>;
}

/**
 * Boot the worker. Returns a handle the caller can `.stop()` for
 * graceful shutdown.
 */
export async function main(options: MainOptions = {}): Promise<MainHandle> {
  const config = options.config
    ? ({ ...loadConfig(), ...options.config } as AppConfig)
    : loadConfig();
  const logger = options.logger ?? buildDefaultLogger(config);

  logger.info(
    {
      service: config.SERVICE_NAME,
      env: config.NODE_ENV,
      port: config.PORT,
    },
    'research-orchestrator: starting',
  );

  const server = createHealthServer({
    port: config.PORT,
    serviceName: config.SERVICE_NAME,
    version: '0.1.0',
  });
  await server.listen();

  // Wire crons if the caller injected the deps. We don't wire DB +
  // Redis here directly — those belong in the per-deployment
  // composition root (k8s-side or api-gateway-side). This keeps the
  // service launchable in unit + integration tests with zero infra.
  let briefingHandle: ReturnType<
    typeof import('./cron/daily-briefing-cron.js').startDailyBriefingCron
  > | null = null;
  if (options.briefingCron) {
    const { startDailyBriefingCron } = await import('./cron/daily-briefing-cron.js');
    briefingHandle = startDailyBriefingCron({
      deps: options.briefingCron.deps,
      tenants: options.briefingCron.tenants,
      hour: config.DAILY_BRIEFING_CRON_HOUR,
      minute: config.DAILY_BRIEFING_CRON_MINUTE,
      logger,
    });
    logger.info(
      {
        hour: config.DAILY_BRIEFING_CRON_HOUR,
        minute: config.DAILY_BRIEFING_CRON_MINUTE,
      },
      'research-orchestrator: daily-briefing cron registered',
    );
  }

  let watchHandle: ReturnType<
    typeof import('./cron/continuous-watch-cron.js').startContinuousWatchCron
  > | null = null;
  if (options.watchCron) {
    const { startContinuousWatchCron } = await import('./cron/continuous-watch-cron.js');
    watchHandle = startContinuousWatchCron({
      deps: options.watchCron.deps,
      watches: options.watchCron.watches,
      sweepIntervalMs: config.CONTINUOUS_WATCH_SWEEP_MS,
      logger,
    });
    logger.info(
      { sweep_ms: config.CONTINUOUS_WATCH_SWEEP_MS },
      'research-orchestrator: continuous-watch cron registered',
    );
  }

  // ─── Graceful shutdown ──────────────────────────────────────────────
  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals | 'manual'): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'research-orchestrator: shutdown requested');
    if (briefingHandle) briefingHandle.stop();
    if (watchHandle) watchHandle.stop();
    await server.close();
    logger.info({}, 'research-orchestrator: shutdown complete');
  };

  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch(() => undefined);
  });
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch(() => undefined);
  });

  return {
    config,
    logger,
    server,
    async stop() {
      await shutdown('manual');
    },
  };
}

function buildDefaultLogger(config: AppConfig): OrchestratorLogger {
  const pino = createLogger({
    service: {
      name: config.SERVICE_NAME,
      version: '0.1.0',
      environment: (config.NODE_ENV === 'test' ? 'development' : config.NODE_ENV) as
        | 'development'
        | 'production'
        | 'staging',
    },
    enabled: true,
    logLevel: config.LOG_LEVEL,
    traceSampleRatio: 0.1,
    metricsIntervalMs: 60_000,
    consoleExport: config.NODE_ENV === 'development',
  });
  return {
    info(obj, msg) {
      pino.info(msg ?? '', obj);
    },
    warn(obj, msg) {
      pino.warn(msg ?? '', obj);
    },
    error(obj, msg) {
      pino.error(msg ?? '', obj);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CLI guard — only run main() when this file is the program entry.
// ─────────────────────────────────────────────────────────────────────────

const isDirect =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /index(\.js|\.ts)?$/.test(process.argv[1]) &&
  process.argv[1].includes('research-orchestrator');

if (isDirect) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console -- bootstrap failure, no logger available yet
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`research-orchestrator: fatal — ${msg}\n`);
    process.exit(2);
  });
}
