/**
 * Sleep pass — scan recent inserts for anomalies and flag them.
 */

import type { PassResult, SleepPass } from '../types.js';
import type { DataQualityAdapter } from './adapters.js';

const PASS_ID = 'data-quality-check';
const DEFAULT_LOOKBACK_MS = 60 * 60_000;

export function createDataQualityCheckPass(
  adapter: DataQualityAdapter,
  lookbackMs = DEFAULT_LOOKBACK_MS,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      cadence: { kind: 'every-minutes', minutes: 30 },
      minIntervalMinutes: 20,
      priority: 2,
      maxDurationMs: 3 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      const rows = await adapter.scanRecentInserts({ sinceMs: lookbackMs });
      let flagged = 0;
      for (const row of rows) {
        if (abortSignal.aborted) break;
        if (row.anomaly) {
          await adapter.flagAnomaly(row);
          flagged++;
        }
      }
      return {
        passId: PASS_ID,
        itemsProcessed: rows.length,
        itemsEmitted: flagged,
        notes: `flagged=${flagged} of ${rows.length}`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
