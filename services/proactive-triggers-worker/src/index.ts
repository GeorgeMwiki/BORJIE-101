/**
 * Proactive Triggers Worker — entrypoint.
 *
 * Env-driven launch shape:
 *   - PROACTIVE_TRIGGERS_INTERVAL_MS — when >0, runs the sweep on a
 *     repeating timer (default 3600000 = 1 hour). When 0, runs once
 *     and exits — that's the Kubernetes CronJob mode.
 *   - PROACTIVE_TRIGGERS_CONCURRENCY — per-sweep tenant concurrency
 *     (default 4).
 *   - PROACTIVE_TRIGGERS_MIN_URGENCY — minimum urgency to fire (1..5,
 *     default 4).
 *   - PROACTIVE_TRIGGERS_LOOKBACK_HOURS — idempotency window
 *     (default 24).
 *
 * The composition root wires real `directory`, `db`, and `sink`
 * implementations and passes them in. This module exports the
 * machinery the root needs.
 */
import { runHourlySweep, type RunSweepDeps } from './schedule/cron-handler.js';
import {
  runFollowupCron,
  type FollowupCronSummary,
  type FollowupCronWiring,
  type RunFollowupCronDeps,
} from './schedule/followup-cron.js';
import {
  runIntelTick,
  type IntelTickSummary,
  type IntelTickWiring,
  type RunIntelTickDeps,
} from './schedule/intel-tick.js';
import { InMemoryIdempotencyCache } from './idempotency/trigger-seen.js';
import { createLogSink } from './sinks/log-sink.js';
import type { SweepSummary, WorkerLogger } from './types.js';

export type { SweepSummary, RunSweepDeps };
export { runHourlySweep };
export { iterateTenants } from './schedule/tenant-iteration.js';
export { InMemoryIdempotencyCache };
export { createLogSink };
// Follow-up schedulers — the previously-unfired user-followup +
// employee-perf-followup crons, now folded into a scheduled pass.
export {
  runFollowupCron,
  type FollowupCronSummary,
  type FollowupCronWiring,
  type RunFollowupCronDeps,
  type UserFollowupWiring,
  type PerfCronWiring,
  type TenantFollowupResult,
} from './schedule/followup-cron.js';
// Proactive-intel tick — `@borjie/proactive-intel` wired into the worker.
export {
  runIntelTick,
  type IntelTickSummary,
  type IntelTickWiring,
  type RunIntelTickDeps,
  type TickContextProvider,
  type RecommendationPublisher,
  type RecommendationComposer,
} from './schedule/intel-tick.js';
// Scientific-discovery trigger — `@borjie/scientific-discovery` wired in
// behind the default-OFF BORJIE_SCIENTIFIC_DISCOVERY_ENABLED flag.
export {
  runDiscoveryTrigger,
  isDiscoveryEnabled,
  DISCOVERY_ENABLED_ENV,
  type DiscoveryTriggerWiring,
  type RunDiscoveryTriggerArgs,
  type DiscoveryTriggerResult,
  type RecurrenceOracle,
  type DataRefProvider,
} from './discovery/discovery-trigger.js';
export { mapAnomalyKindToDiscoveryArea } from './discovery/area-map.js';
export {
  cardToRecommendation,
  type CardToRecommendationInput,
} from './discovery/card-to-recommendation.js';
// Real notification delivery — the default sink + its building blocks.
export {
  createNotificationSink,
  type CreateNotificationSinkArgs,
  type NotificationRecipient,
  type RecipientResolver,
} from './sinks/notification-sink.js';
export {
  createEmailChannelDispatcher,
  type EmailDispatcherDeps,
  type LicenceExpiryFacts,
} from './sinks/email-dispatcher.js';
export {
  selectSink,
  type SelectSinkArgs,
  type NotificationWiring,
} from './sinks/select-sink.js';
export type {
  ActiveUser,
  IdempotencyCache,
  TenantDirectory,
  TenantSweepResult,
  TriggerSink,
  WorkerLogger,
} from './types.js';

/**
 * Launch shape — long-running loop OR single-shot. Returns the running
 * timer handles (when interval > 0) or `null` (one-shot). Consumer is
 * responsible for clearing the timers on shutdown.
 *
 * The worker now drives THREE scheduled passes, all on the same launch
 * shape:
 *   1. The proactive-triggers hourly sweep (always on — the original).
 *   2. The follow-up cron (user-followup + employee-perf-followup) —
 *      runs only when `followup` wiring is supplied.
 *   3. The proactive-intel tick — runs only when `intel` wiring is
 *      supplied.
 *
 * Each pass runs once immediately at launch and then on the shared
 * interval. The follow-up cron + intel tick are folded into the same
 * timer tick as the sweep so a single hourly wake drives everything;
 * the employee-perf cron's own 06:00-local fire-window check means an
 * hourly drive still fires it exactly once per day per employee.
 */
export interface LaunchArgs {
  readonly deps: RunSweepDeps;
  readonly intervalMs?: number;
  readonly onSweepComplete?: (summary: SweepSummary) => void;
  /**
   * Follow-up cron wiring. When omitted, the follow-up cron is skipped.
   * The composition root binds the SQL-backed repos (from `deps.db`) +
   * reuses the notification dispatchers here.
   */
  readonly followup?: FollowupCronWiring;
  readonly onFollowupComplete?: (summary: FollowupCronSummary) => void;
  /**
   * Proactive-intel tick wiring. When omitted, the tick is skipped.
   */
  readonly intel?: IntelTickWiring;
  readonly onIntelComplete?: (summary: IntelTickSummary) => void;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Start the worker. Returns the interval handles when looping; null
 * when running one-shot. Every pass runs once immediately.
 */
export async function launchProactiveTriggersWorker(
  args: LaunchArgs,
): Promise<{ handle: ReturnType<typeof setInterval> | null }> {
  const intervalMs = args.intervalMs ?? envInterval();
  const logger: WorkerLogger | undefined = args.deps.logger;

  logger?.info?.(
    {
      intervalMs,
      followup: args.followup !== undefined,
      intel: args.intel !== undefined,
    },
    intervalMs === 0
      ? 'proactive-triggers-worker: one-shot mode'
      : 'proactive-triggers-worker: starting hourly loop',
  );

  // Run every pass once immediately.
  await runAllPasses(args, logger);

  if (intervalMs <= 0) {
    return { handle: null };
  }

  const handle = setInterval(() => {
    runAllPasses(args, logger).catch((err: unknown) => {
      logger?.warn?.(
        { err: err instanceof Error ? err.message : String(err) },
        'proactive-triggers-worker: scheduled passes failed catastrophically',
      );
    });
  }, intervalMs);

  return { handle };
}

/**
 * Run the sweep, follow-up cron, and intel tick once each. The sweep
 * always runs; the other two run only when wired. Each pass is
 * independently guarded — one failing pass never sinks the others.
 */
async function runAllPasses(
  args: LaunchArgs,
  logger: WorkerLogger | undefined,
): Promise<void> {
  // 1. Proactive-triggers sweep (always).
  try {
    const summary = await runHourlySweep(args.deps);
    args.onSweepComplete?.(summary);
    logger?.info?.(
      {
        tenantsProcessed: summary.tenantsProcessed,
        triggersFired: summary.triggersFired,
        suppressedIdempotent: summary.triggersSuppressedIdempotent,
        suppressedLowUrgency: summary.triggersSuppressedLowUrgency,
      },
      'proactive-triggers-worker: sweep complete',
    );
  } catch (err: unknown) {
    logger?.warn?.(
      { err: err instanceof Error ? err.message : String(err) },
      'proactive-triggers-worker: sweep failed',
    );
  }

  // 2. Follow-up cron (user-followup + employee-perf-followup).
  if (args.followup) {
    try {
      const followupDeps: RunFollowupCronDeps = {
        directory: args.deps.directory,
        wiring: args.followup,
        ...(logger ? { logger } : {}),
        ...(args.deps.concurrency !== undefined
          ? { concurrency: args.deps.concurrency }
          : {}),
      };
      const fSummary = await runFollowupCron(followupDeps);
      args.onFollowupComplete?.(fSummary);
      logger?.info?.(
        {
          tenantsProcessed: fSummary.tenantsProcessed,
          dispatched: fSummary.userFollowupDispatched,
          suppressed: fSummary.userFollowupSuppressed,
          perfNudges: fSummary.perfNudgesEmitted,
        },
        'proactive-triggers-worker: follow-up cron complete',
      );
    } catch (err: unknown) {
      logger?.warn?.(
        { err: err instanceof Error ? err.message : String(err) },
        'proactive-triggers-worker: follow-up cron failed',
      );
    }
  }

  // 3. Proactive-intel tick.
  if (args.intel) {
    try {
      const intelDeps: RunIntelTickDeps = {
        directory: args.deps.directory,
        wiring: args.intel,
        ...(logger ? { logger } : {}),
        ...(args.deps.concurrency !== undefined
          ? { concurrency: args.deps.concurrency }
          : {}),
      };
      const iSummary = await runIntelTick(intelDeps);
      args.onIntelComplete?.(iSummary);
      logger?.info?.(
        {
          tenantsProcessed: iSummary.tenantsProcessed,
          anomalies: iSummary.anomaliesDetected,
          recommendations: iSummary.recommendationsPublished,
        },
        'proactive-triggers-worker: intel tick complete',
      );
    } catch (err: unknown) {
      logger?.warn?.(
        { err: err instanceof Error ? err.message : String(err) },
        'proactive-triggers-worker: intel tick failed',
      );
    }
  }
}

function envInterval(): number {
  const raw = process.env['PROACTIVE_TRIGGERS_INTERVAL_MS'];
  if (raw === undefined) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INTERVAL_MS;
}
