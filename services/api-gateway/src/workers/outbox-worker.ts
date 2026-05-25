/**
 * Outbox worker — drains events written to the outbox table and
 * publishes them on the in-process event bus.
 *
 * Why: services write events transactionally via the outbox so that a
 * failed publish cannot leave the aggregate mutated but the downstream
 * unnotified. Without a worker draining the outbox, events accumulate
 * forever and no subscriber ever runs. This module is the drainer.
 *
 * Lifecycle: `startOutboxWorker()` schedules a recurring drain on a
 * configurable interval. Graceful-shutdown hooks call `stopOutboxWorker`
 * to cancel the timer and let in-flight batches complete.
 */

import type pino from 'pino';

export interface OutboxRunnerLike {
  processOutbox(batchSize?: number): Promise<number>;
}

export interface OutboxWorkerConfig {
  /** How often to drain (ms). Defaults to 5s in prod, 1s in dev. */
  intervalMs?: number;
  /** Max events per batch. Keep small so failures don't block a big page. */
  batchSize?: number;
  /** Logger — typically the service's pino instance. */
  logger: pino.Logger;
  /** Skip the drainer in specific environments (e.g. tests). */
  enabled?: boolean;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Start the outbox drainer. Safe to call multiple times — subsequent
 * calls are ignored until stopOutboxWorker() is called.
 */
export function startOutboxWorker(
  runner: OutboxRunnerLike,
  config: OutboxWorkerConfig
): void {
  if (timer) {
    config.logger.warn('outbox worker: already running, ignoring duplicate start');
    return;
  }
  if (config.enabled === false) {
    config.logger.info('outbox worker: disabled by config');
    return;
  }

  const intervalMs = config.intervalMs ?? 5_000;
  const batchSize = config.batchSize ?? 50;

  config.logger.info(
    { intervalMs, batchSize },
    'outbox worker started'
  );

  const tick = async () => {
    if (running) return; // Skip tick if previous batch still draining.
    running = true;
    try {
      const n = await runner.processOutbox(batchSize);
      if (n > 0) {
        config.logger.debug({ processed: n }, 'outbox drained');
      }
    } catch (err) {
      // Outbox drain failures must never crash the API gateway process.
      // Log and retry on next tick — individual event failures are
      // handled inside processOutbox (retry + dead-letter).
      config.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'outbox drain failed'
      );
    } finally {
      running = false;
    }
  };

  timer = setInterval(tick, intervalMs);
  timer.unref?.();

  // Kick off one immediate drain so the queue doesn't sit idle at boot.
  void tick();
}

/**
 * Stop the drainer. The current tick (if any) is allowed to complete.
 * Safe to call before startOutboxWorker (no-op).
 */
export function stopOutboxWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Exposed for tests — are we running? */
export function isOutboxWorkerRunning(): boolean {
  return timer !== null;
}
