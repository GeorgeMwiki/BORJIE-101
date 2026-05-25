/**
 * Sleep pass — pre-warm hot caches by re-computing common keys.
 */

import type { PassResult, SleepPass } from '../types.js';
import type { CacheAdapter } from './adapters.js';

const PASS_ID = 'cache-warm-up';

export interface CacheWarmUpEntry {
  readonly key: string;
  /** Lazy compute — only called when warming. */
  compute(): Promise<unknown>;
}

export function createCacheWarmUpPass(
  adapter: CacheAdapter,
  entries: ReadonlyArray<CacheWarmUpEntry>,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      cadence: { kind: 'hourly', offsetMinutes: 5 },
      minIntervalMinutes: 30,
      priority: 3,
      maxDurationMs: 4 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      let warmed = 0;
      for (const e of entries) {
        if (abortSignal.aborted) break;
        try {
          const value = await e.compute();
          await adapter.prewarm(e.key, value);
          warmed++;
        } catch {
          // Skip + continue
        }
      }
      return {
        passId: PASS_ID,
        itemsProcessed: entries.length,
        itemsEmitted: warmed,
        notes: `warmed=${warmed} of ${entries.length}`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
