/**
 * nightly-aggregator-cron — node-cron schedule wrapper.
 *
 * Schedule: 03:00 UTC every day. One hour after the ui-evolution-worker
 * runs at 02:00 UTC, so load on the LLM router + DB is spread across
 * the early morning window.
 *
 * The cron handle returned by `node-cron.schedule` is opaque; we expose
 * the same interface (`stop`) the brain-evolution-worker exposes.
 */

import cron from 'node-cron';
import { runNightlyAggregation } from '../aggregator/nightly-aggregator.js';
import type {
  NightlyAggregatorDeps,
  NightlyAggregatorConfig,
} from '../aggregator/nightly-aggregator.js';
import type { NightlyAggregationSummary, WorkerLogger } from '../types.js';

export interface CronHandle {
  stop(): void;
}

export interface ScheduleArgs {
  readonly cronExpr: string;
  readonly deps: NightlyAggregatorDeps;
  readonly config: NightlyAggregatorConfig;
  readonly onComplete?: (summary: NightlyAggregationSummary) => void;
  readonly logger?: WorkerLogger;
}

/**
 * Validate then schedule the nightly aggregation. Returns a handle the
 * caller can `stop()` on graceful shutdown.
 */
export function scheduleNightlyAggregator(args: ScheduleArgs): CronHandle {
  if (!cron.validate(args.cronExpr)) {
    throw new Error(
      `nightly-aggregator-cron: invalid cron expression "${args.cronExpr}"`,
    );
  }

  const task = cron.schedule(
    args.cronExpr,
    () => {
      runNightlyAggregation(args.deps, args.config)
        .then((summary) => {
          args.onComplete?.(summary);
          args.logger?.info?.(
            {
              recipes_scanned: summary.recipes_scanned,
              lock_decisions: summary.lock_decisions,
              improve_decisions: summary.improve_decisions,
              errored: summary.errored,
            },
            'doc-evolution-worker: nightly aggregation complete',
          );
        })
        .catch((err: unknown) => {
          args.logger?.warn?.(
            { err: err instanceof Error ? err.message : String(err) },
            'doc-evolution-worker: nightly aggregation crashed',
          );
        });
    },
    { scheduled: true, timezone: 'UTC' },
  );

  return {
    stop(): void {
      task.stop();
    },
  };
}
