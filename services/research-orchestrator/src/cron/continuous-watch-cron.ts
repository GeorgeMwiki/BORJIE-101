/**
 * Continuous-watch cron — polls due watches and runs the
 * Continuous Watch mode for each.
 *
 * Behaviour:
 *
 *   - Every CONTINUOUS_WATCH_SWEEP_MS ms (default 60 s), call
 *     WatchRepository.listDue(now). For each due watch:
 *     1. Run the watch's plan via `runContinuousWatch`.
 *     2. Advance `next_run_at = now + cadence_minutes` via
 *        WatchRepository.markRan.
 *   - Bounded concurrency (CONTINUOUS_WATCH_CONCURRENCY) so a tenant
 *     with many watches doesn't stampede.
 *   - Per-watch try/catch so one failure doesn't poison the sweep.
 *
 * @module research-orchestrator/cron/continuous-watch-cron
 */

import { runContinuousWatch } from '../modes/continuous-watch.js';
import type { OrchestratorLogger } from '../types.js';
import type { ModeRunDeps } from '../modes/shared.js';
import type { WatchRepository } from '../storage/watch-repository.js';

export interface ContinuousWatchCronOptions {
  readonly deps: ModeRunDeps;
  readonly watches: WatchRepository;
  readonly sweepIntervalMs: number;
  readonly concurrency?: number;
  readonly logger?: OrchestratorLogger;
  readonly now?: () => Date;
}

export interface ContinuousWatchCronHandle {
  stop(): void;
  /** Invoke the sweep once. Exposed for tests + the one-shot run mode. */
  runOnce(): Promise<{ readonly watchesFired: number }>;
}

const DEFAULT_CONCURRENCY = 4;

export function startContinuousWatchCron(
  options: ContinuousWatchCronOptions,
): ContinuousWatchCronHandle {
  const nowFn = options.now ?? (() => new Date());
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  async function sweep(): Promise<{ watchesFired: number }> {
    const now = nowFn();
    const dueList = await safeList(options, now.toISOString());
    if (dueList.length === 0) return { watchesFired: 0 };

    let fired = 0;
    // Simple bounded-concurrency runner.
    for (let i = 0; i < dueList.length; i += concurrency) {
      const slice = dueList.slice(i, i + concurrency);
      await Promise.all(
        slice.map(async (watch) => {
          try {
            await runContinuousWatch(
              {
                watchId: watch.id,
                tenantId: watch.tenantId,
                topic: watch.topic,
                thresholds: watch.thresholds,
              },
              options.deps,
              options.logger,
            );
            const nextRunAt = new Date(
              now.getTime() + watch.cadenceMinutes * 60_000,
            );
            await options.watches.markRan({
              id: watch.id,
              ran_at_iso: now.toISOString(),
              next_run_at_iso: nextRunAt.toISOString(),
            });
            fired += 1;
          } catch (error) {
            options.logger?.warn(
              {
                watch_id: watch.id,
                tenant_id: watch.tenantId,
                err: error instanceof Error ? error.message : String(error),
              },
              'continuous-watch-cron: watch run failed',
            );
          }
        }),
      );
    }

    if (fired > 0) {
      options.logger?.info({ watches_fired: fired }, 'continuous-watch-cron: sweep complete');
    }
    return { watchesFired: fired };
  }

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  timer = setInterval(() => {
    if (stopped) return;
    sweep().catch((err: unknown) => {
      options.logger?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'continuous-watch-cron: sweep failed catastrophically',
      );
    });
  }, options.sweepIntervalMs);

  // Fire the first sweep immediately so we don't wait one cadence on
  // startup.
  sweep().catch((err: unknown) => {
    options.logger?.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'continuous-watch-cron: initial sweep failed',
    );
  });

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    async runOnce() {
      return sweep();
    },
  };
}

async function safeList(
  options: ContinuousWatchCronOptions,
  nowIso: string,
): Promise<ReadonlyArray<import('../types.js').DueWatch>> {
  try {
    return await options.watches.listDue(nowIso);
  } catch (error) {
    options.logger?.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'continuous-watch-cron: listDue failed',
    );
    return [];
  }
}
