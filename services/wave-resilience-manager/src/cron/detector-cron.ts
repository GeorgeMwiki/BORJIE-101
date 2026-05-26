/**
 * Detector cron — wraps `runCrashDetectorSweep` in a 60 s timer.
 *
 * Pattern matches services/research-orchestrator/src/cron/
 * continuous-watch-cron.ts: fire immediately on start, then on every
 * tick; per-tick errors are swallowed + logged.
 */

import {
  runCrashDetectorSweep,
  type CrashDetectorDeps,
} from '../detector/crash-detector.js';
import type { ResilienceLogger } from '../types.js';

export interface DetectorCronHandle {
  stop(): void;
  /** Force a single sweep. Exposed for tests + diagnostics. */
  runOnce(): Promise<{
    readonly scanned: number;
    readonly crashed: ReadonlyArray<string>;
  }>;
}

export interface DetectorCronOptions {
  readonly deps: CrashDetectorDeps;
  readonly intervalMs: number;
  readonly logger?: ResilienceLogger;
}

export function startDetectorCron(
  options: DetectorCronOptions,
): DetectorCronHandle {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  // Carry the chain state forward across sweeps.
  let chain = options.deps.chainState;

  async function sweep(): Promise<{
    scanned: number;
    crashed: ReadonlyArray<string>;
  }> {
    const deps: CrashDetectorDeps = { ...options.deps, chainState: chain };
    const res = await runCrashDetectorSweep(deps);
    if (res.nextChainHash !== null) {
      chain = { previousHash: res.nextChainHash };
    }
    return { scanned: res.scanned, crashed: res.crashed };
  }

  timer = setInterval(() => {
    if (stopped) return;
    sweep().catch((err: unknown) => {
      options.logger?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'detector-cron: sweep failed',
      );
    });
  }, options.intervalMs);

  // Fire once immediately.
  sweep().catch((err: unknown) => {
    options.logger?.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'detector-cron: initial sweep failed',
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
