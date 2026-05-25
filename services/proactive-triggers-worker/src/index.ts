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
import { InMemoryIdempotencyCache } from './idempotency/trigger-seen.js';
import { createLogSink } from './sinks/log-sink.js';
import type { SweepSummary, WorkerLogger } from './types.js';

export type { SweepSummary, RunSweepDeps };
export { runHourlySweep };
export { iterateTenants } from './schedule/tenant-iteration.js';
export { InMemoryIdempotencyCache };
export { createLogSink };
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
 * timer handle (when interval > 0) or `null` (one-shot). Consumer is
 * responsible for clearing the timer on shutdown.
 */
export interface LaunchArgs {
  readonly deps: RunSweepDeps;
  readonly intervalMs?: number;
  readonly onSweepComplete?: (summary: SweepSummary) => void;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Start the worker. Returns the interval handle when looping; null
 * when running one-shot. The first sweep always runs immediately.
 */
export async function launchProactiveTriggersWorker(
  args: LaunchArgs,
): Promise<{ handle: ReturnType<typeof setInterval> | null }> {
  const intervalMs = args.intervalMs ?? envInterval();
  const logger: WorkerLogger | undefined = args.deps.logger;

  logger?.info?.(
    { intervalMs },
    intervalMs === 0
      ? 'proactive-triggers-worker: one-shot mode'
      : 'proactive-triggers-worker: starting hourly loop',
  );

  // Run once immediately.
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

  if (intervalMs <= 0) {
    return { handle: null };
  }

  const handle = setInterval(() => {
    runHourlySweep(args.deps)
      .then((s) => {
        args.onSweepComplete?.(s);
        logger?.info?.(
          {
            tenantsProcessed: s.tenantsProcessed,
            triggersFired: s.triggersFired,
          },
          'proactive-triggers-worker: sweep complete',
        );
      })
      .catch((err: unknown) => {
        logger?.warn?.(
          { err: err instanceof Error ? err.message : String(err) },
          'proactive-triggers-worker: sweep failed catastrophically',
        );
      });
  }, intervalMs);

  return { handle };
}

function envInterval(): number {
  const raw = process.env['PROACTIVE_TRIGGERS_INTERVAL_MS'];
  if (raw === undefined) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INTERVAL_MS;
}
