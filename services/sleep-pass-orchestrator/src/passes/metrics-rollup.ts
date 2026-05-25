/**
 * Sleep pass — aggregate hourly metrics into daily rollups.
 */

import type { PassResult, SleepPass } from '../types.js';
import type { MetricsAdapter, DailyMetric } from './adapters.js';

const PASS_ID = 'metrics-rollup';
const DEFAULT_LOOKBACK_MS = 26 * 60 * 60_000;

export function createMetricsRollupPass(
  adapter: MetricsAdapter,
  lookbackMs = DEFAULT_LOOKBACK_MS,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      cadence: { kind: 'daily', hour: 1, minute: 30 },
      minIntervalMinutes: 60 * 20,
      priority: 3,
      maxDurationMs: 10 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      const hourly = await adapter.fetchHourly({ sinceMs: lookbackMs });
      const buckets = new Map<string, { sum: number; count: number; day: string }>();
      for (const m of hourly) {
        if (abortSignal.aborted) break;
        const dayKey = m.hour.slice(0, 10);
        const k = `${dayKey}|${m.key}`;
        const existing = buckets.get(k);
        if (existing) {
          buckets.set(k, {
            sum: existing.sum + m.value,
            count: existing.count + 1,
            day: existing.day,
          });
        } else {
          buckets.set(k, { sum: m.value, count: 1, day: `${dayKey}T00:00:00.000Z` });
        }
      }
      let emitted = 0;
      for (const [k, v] of buckets) {
        if (abortSignal.aborted) break;
        const key = k.split('|', 2)[1] ?? '';
        const daily: DailyMetric = { day: v.day, key, sum: v.sum, count: v.count };
        await adapter.upsertDaily(daily);
        emitted++;
      }
      return {
        passId: PASS_ID,
        itemsProcessed: hourly.length,
        itemsEmitted: emitted,
        notes: `rolled-up=${emitted} dailies from ${hourly.length} hourlies`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
