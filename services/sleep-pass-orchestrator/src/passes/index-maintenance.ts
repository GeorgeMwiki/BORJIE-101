/**
 * Sleep pass — REINDEX hot tables flagged by the index adapter.
 */

import type { PassResult, SleepPass } from '../types.js';
import type { IndexAdapter } from './adapters.js';

const PASS_ID = 'index-maintenance';

export function createIndexMaintenancePass(
  adapter: IndexAdapter,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      cadence: { kind: 'daily', hour: 3, minute: 0 },
      minIntervalMinutes: 60 * 20,
      priority: 4,
      maxDurationMs: 15 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      const hot = await adapter.listHotIndexes();
      let done = 0;
      let failed = 0;
      for (const table of hot) {
        if (abortSignal.aborted) break;
        try {
          const { ok } = await adapter.reindex(table);
          if (ok) done++;
          else failed++;
        } catch {
          failed++;
        }
      }
      return {
        passId: PASS_ID,
        itemsProcessed: hot.length,
        itemsEmitted: done,
        notes: `reindexed=${done} failed=${failed} of ${hot.length}`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
