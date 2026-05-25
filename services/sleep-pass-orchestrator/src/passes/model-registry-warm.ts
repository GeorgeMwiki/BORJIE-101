/**
 * Sleep pass — warm the dynamic model registry.
 *
 * Refreshes the L1 cache in `@borjie/brain-llm-router/dynamic-registry`
 * by calling its `warmAllFamilies()` function. This means the hot-path
 * `getModelLatest("opus")` consumer almost never sees the L3 baseline
 * fallback path — by the time a brain-call lands, the cache is hot.
 *
 * The warmer is **injected** (rather than imported directly) so this
 * service stays free of a build-time dependency on the router package
 * — composition roots supply the real `warmAllFamilies` via this
 * factory at boot. In the in-memory standalone bootstrap we pass a
 * no-op warmer so the pod still runs cleanly without provisioning.
 */

import type { PassResult, SleepPass } from '../types.js';

const PASS_ID = 'model-registry-warm';

export interface ModelRegistryWarmer {
  /** Resolve every model family against its upstream provider /v1/models. */
  warmAllFamilies(): Promise<void>;
}

export function createModelRegistryWarmPass(
  warmer: ModelRegistryWarmer,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      // Hourly, 8 min past the hour (avoid lining up with other passes).
      cadence: { kind: 'hourly', offsetMinutes: 8 },
      // Never re-warm more often than every 30 min even if heartbeat
      // dispatches us early — model ids don't change that fast and we
      // want to be polite to provider /v1/models endpoints.
      minIntervalMinutes: 30,
      priority: 4,
      // 30s total — 17 families × 5s timeout, in parallel, with slack.
      maxDurationMs: 30_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      let errored = false;
      let notes = 'warmed all model families';
      try {
        await warmer.warmAllFamilies();
      } catch (err) {
        errored = true;
        notes = `warm failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      return {
        passId: PASS_ID,
        itemsProcessed: 1,
        itemsEmitted: errored ? 0 : 1,
        notes,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored,
      };
    },
  };
}
