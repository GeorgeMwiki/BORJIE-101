/**
 * Worker Registry
 *
 * Central registry describing every periodic worker the platform runs.
 * Consumed by `scheduler-runner.ts` at boot to wire each worker to a
 * `node-cron` schedule and by the `/healthz` endpoint to report
 * registered workers + last-run timestamps.
 *
 * Workers are declared as plain descriptors — the runner owns the
 * cron binding, concurrency guard, and observability. Handlers MUST
 * be idempotent because node-cron fires on multiple instances if the
 * scheduler is scaled horizontally (we only run one replica in prod
 * but the contract holds either way).
 */

export type WorkerId =
  | 'renewal-scheduler'
  | 'sla-worker'
  | 'vendor-rating-worker'
  | 'intelligence-history-worker'
  | 'far-scheduler'
  | 'waitlist-vacancy-backfill'
  | 'arrears-projection-refresh';

export interface WorkerRunStats {
  readonly workerId: WorkerId;
  /** Last successful tick timestamp (ISO-8601). */
  lastSuccessAt: string | null;
  /** Last error tick timestamp (ISO-8601). */
  lastErrorAt: string | null;
  /** Last error message (truncated). */
  lastErrorMessage: string | null;
  /** Total successful ticks since boot. */
  successCount: number;
  /** Total error ticks since boot. */
  errorCount: number;
}

export interface WorkerHandler {
  /** Handler is invoked on every cron tick. MUST be idempotent. */
  (): Promise<void>;
}

export interface WorkerDescriptor {
  readonly id: WorkerId;
  /** Human-friendly description for /healthz and logs. */
  readonly description: string;
  /**
   * node-cron expression in the scheduler container's local TZ
   * (default UTC in the Dockerfile).
   */
  readonly cron: string;
  /**
   * Handler executed on each tick. Receives no args — workers must
   * close over their dependencies via `createWorkerRegistry(deps)`.
   */
  readonly handler: WorkerHandler;
  /**
   * If true, the runner skips this worker entirely. Used to disable
   * workers per-environment without editing code.
   */
  readonly disabled?: boolean;
  /**
   * Max wall-clock for a single tick. If exceeded, the watchdog
   * records an error and the next tick is allowed to start.
   */
  readonly timeoutMs?: number;
}

/**
 * The bag of dependencies every worker needs. Kept explicit so each
 * worker's real implementation can be swapped in without reaching
 * into module singletons.
 */
export interface WorkerRegistryDeps {
  readonly runRenewalScheduler: () => Promise<void>;
  readonly runSlaWorker: () => Promise<void>;
  readonly runVendorRatingWorker: () => Promise<void>;
  readonly runIntelligenceHistoryWorker: () => Promise<void>;
  readonly runFarScheduler: () => Promise<void>;
  readonly runWaitlistVacancyBackfill: () => Promise<void>;
  readonly runArrearsProjectionRefresh: () => Promise<void>;
}

/**
 * Build the canonical descriptor list. The cron expressions below
 * reflect the operational SLOs called out in the platform spec:
 *   - SLA worker: every 5 minutes
 *   - Waitlist backfill: hourly
 *   - FAR scheduler: hourly
 *   - Renewal / vendor-rating / intelligence / arrears: nightly
 */
export function createWorkerRegistry(
  deps: WorkerRegistryDeps,
): WorkerDescriptor[] {
  return [
    {
      id: 'renewal-scheduler',
      description: 'Daily T-90/60/30 lease renewal sweep',
      cron: '0 2 * * *', // 02:00 daily
      handler: deps.runRenewalScheduler,
      timeoutMs: 5 * 60 * 1000,
    },
    {
      id: 'sla-worker',
      description: 'Case SLA breach detection + auto-escalation',
      cron: '*/5 * * * *', // every 5 minutes
      handler: deps.runSlaWorker,
      timeoutMs: 2 * 60 * 1000,
    },
    {
      id: 'vendor-rating-worker',
      description: 'Nightly 180-day vendor rating recompute',
      cron: '30 2 * * *', // 02:30 daily
      handler: deps.runVendorRatingWorker,
      timeoutMs: 15 * 60 * 1000,
    },
    {
      id: 'intelligence-history-worker',
      description: 'Daily customer risk/churn/sentiment snapshot',
      cron: '0 3 * * *', // 03:00 daily
      handler: deps.runIntelligenceHistoryWorker,
      timeoutMs: 30 * 60 * 1000,
    },
    {
      id: 'far-scheduler',
      description: 'Hourly Financial Account Review due-check',
      cron: '15 * * * *', // :15 every hour
      handler: deps.runFarScheduler,
      timeoutMs: 5 * 60 * 1000,
    },
    {
      id: 'waitlist-vacancy-backfill',
      description:
        'Hourly backfill for UnitVacated outreach missed by the event bus',
      cron: '45 * * * *', // :45 every hour
      handler: deps.runWaitlistVacancyBackfill,
      timeoutMs: 5 * 60 * 1000,
    },
    {
      id: 'arrears-projection-refresh',
      description: 'Nightly arrears projection materialised-view refresh',
      cron: '0 4 * * *', // 04:00 daily
      handler: deps.runArrearsProjectionRefresh,
      timeoutMs: 30 * 60 * 1000,
    },
  ];
}

/** Immutable empty stats row — helpers always return a *new* object. */
export function emptyStats(workerId: WorkerId): WorkerRunStats {
  return {
    workerId,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
    successCount: 0,
    errorCount: 0,
  };
}

export function recordSuccess(stats: WorkerRunStats): WorkerRunStats {
  return {
    ...stats,
    lastSuccessAt: new Date().toISOString(),
    successCount: stats.successCount + 1,
  };
}

export function recordError(
  stats: WorkerRunStats,
  error: unknown,
): WorkerRunStats {
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown error');
  return {
    ...stats,
    lastErrorAt: new Date().toISOString(),
    lastErrorMessage: message.slice(0, 500),
    errorCount: stats.errorCount + 1,
  };
}
