/**
 * Health check — `/health` reports the worker's operational state.
 *
 * The handler is framework-agnostic. The composition root in
 * `index.ts` decides whether to bind it to an HTTP server (when the
 * worker is supervised by a long-lived process) or skip it (when the
 * worker runs as a Kubernetes one-shot CronJob).
 *
 * Status semantics:
 *   - `ok`        — last sweep finished successfully, recent enough.
 *   - `degraded`  — last sweep finished with errors OR is stale.
 *   - `down`      — never ran, or essential infrastructure missing.
 */

import type { NightlySweepSummary } from '../types.js';

export interface HealthSnapshot {
  readonly status: 'ok' | 'degraded' | 'down';
  readonly lastSweepFinishedAtIso: string | null;
  readonly lastSweepRecipesProcessed: number;
  readonly lastSweepProposalsEmitted: number;
  readonly lastSweepErrored: number;
  readonly schedule: string;
  readonly operational: boolean;
}

export interface HealthState {
  lastSummary: NightlySweepSummary | null;
  schedule: string;
  operational: boolean;
}

const STALE_SWEEP_MS = 26 * 60 * 60 * 1000; // 26 hours

/**
 * Build the snapshot. Pure function over the supplied state — the
 * route handler binds it to a clock for staleness checking.
 */
export function buildHealthSnapshot(args: {
  readonly state: HealthState;
  readonly nowMs: number;
}): HealthSnapshot {
  const { state, nowMs } = args;
  if (!state.operational) {
    return {
      status: 'down',
      lastSweepFinishedAtIso: null,
      lastSweepRecipesProcessed: 0,
      lastSweepProposalsEmitted: 0,
      lastSweepErrored: 0,
      schedule: state.schedule,
      operational: false,
    };
  }
  if (!state.lastSummary) {
    return {
      status: 'degraded',
      lastSweepFinishedAtIso: null,
      lastSweepRecipesProcessed: 0,
      lastSweepProposalsEmitted: 0,
      lastSweepErrored: 0,
      schedule: state.schedule,
      operational: true,
    };
  }
  const finishedAtMs = new Date(state.lastSummary.finishedAtIso).getTime();
  const stale =
    !Number.isFinite(finishedAtMs) ||
    nowMs - finishedAtMs > STALE_SWEEP_MS;
  const hasErrors = state.lastSummary.errored > 0;

  return {
    status: stale ? 'degraded' : hasErrors ? 'degraded' : 'ok',
    lastSweepFinishedAtIso: state.lastSummary.finishedAtIso,
    lastSweepRecipesProcessed: state.lastSummary.recipesProcessed,
    lastSweepProposalsEmitted: state.lastSummary.proposalsEmitted,
    lastSweepErrored: state.lastSummary.errored,
    schedule: state.schedule,
    operational: true,
  };
}

/**
 * HTTP-style handler — minimal framework-agnostic shape, returns the
 * JSON body + numeric status code. Tested in isolation; the index
 * binds it to a server (or skips it in CronJob mode).
 */
export function handleHealthRequest(state: HealthState): {
  readonly status: number;
  readonly body: HealthSnapshot;
} {
  const snapshot = buildHealthSnapshot({ state, nowMs: Date.now() });
  return {
    status: snapshot.status === 'ok' ? 200 : 503,
    body: snapshot,
  };
}
