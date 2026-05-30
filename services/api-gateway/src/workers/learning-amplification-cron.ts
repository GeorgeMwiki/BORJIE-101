/**
 * Learning Amplification cron worker.
 *
 * Wraps `runAmplification()` from @borjie/learning-amplification in the
 * Borjie supervisor lifecycle (start / stop / tickOnce). The job rolls
 * up the learning_observations window with exponential decay and
 * adjusts truth_claims confidence + status. Default cadence is 24h
 * (nightly at ~02:00 in the deploy timezone — the supervisor doesn't
 * pin a wall-clock; the interval is enough for "user 100 > user 50"
 * proof).
 *
 * Lifecycle:
 *   - start() arms an interval (default 24h, override via
 *     BORJIE_LEARNING_AMPLIFY_INTERVAL_MS).
 *   - tickOnce() exposed for tests / manual triggers.
 *   - stop() clears the timer.
 *
 * Failure containment:
 *   - configureLearningAmplification not called (env unset) →
 *     runAmplification() returns a zero-summary; the worker logs once
 *     and continues to no-op on cadence.
 *   - Per-tick exceptions are caught and logged via Pino.
 */

import type { Logger as PinoLogger } from 'pino';

import {
  runAmplification,
  type AmplificationRunSummary,
} from '@borjie/learning-amplification';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface LearningAmplificationCronOptions {
  readonly logger: PinoLogger;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
}

export interface LearningAmplificationCronHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<AmplificationRunSummary>;
}

export function createLearningAmplificationCron(
  options: LearningAmplificationCronOptions,
): LearningAmplificationCronHandle {
  const intervalMs = options.intervalMs ?? readEnvInterval() ?? DEFAULT_INTERVAL_MS;
  const enabled = options.enabled ?? true;
  const logger = options.logger;

  let timer: ReturnType<typeof setInterval> | null = null;

  async function tickOnce(): Promise<AmplificationRunSummary> {
    try {
      const summary = await runAmplification();
      logger.info(
        {
          worker: 'learning-amplification',
          observationsConsumed: summary.observationsConsumed,
          claimsPromoted: summary.claimsPromoted,
          claimsDemoted: summary.claimsDemoted,
          cohorts: summary.cohorts.length,
        },
        'learning-amplification: tick complete',
      );
      workerHeartbeat('learning-amplification');
      return summary;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'learning-amplification: tick failed',
      );
      workerHeartbeatFailure('learning-amplification', err);
      return {
        observationsConsumed: 0,
        claimsPromoted: 0,
        claimsDemoted: 0,
        confidenceUpdates: [],
        cohorts: [],
      };
    }
  }

  function start(): void {
    if (!enabled || timer !== null) return;
    registerWorker({ name: 'learning-amplification', intervalMs });
    logger.info(
      { worker: 'learning-amplification', intervalMs },
      'learning-amplification: started',
    );
    timer = setInterval(() => {
      void tickOnce();
    }, intervalMs);
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
      logger.info(
        { worker: 'learning-amplification' },
        'learning-amplification: stopped',
      );
    }
  }

  return Object.freeze({ start, stop, tickOnce });
}

function readEnvInterval(): number | null {
  const raw = process.env.BORJIE_LEARNING_AMPLIFY_INTERVAL_MS?.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 60_000) return null;
  return n;
}
