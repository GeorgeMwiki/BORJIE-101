/**
 * Sleep pass — flag tenants inactive >N days.
 */

import type { PassResult, SleepPass } from '../types.js';
import type { TenantAdapter } from './adapters.js';

const PASS_ID = 'dormant-tenant-detector';
const DEFAULT_DORMANT_DAYS = 30;

export function createDormantTenantDetectorPass(
  adapter: TenantAdapter,
  dormantDays = DEFAULT_DORMANT_DAYS,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      cadence: { kind: 'daily', hour: 4, minute: 0 },
      minIntervalMinutes: 60 * 20,
      priority: 4,
      maxDurationMs: 5 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      const cutoffMs = now().getTime() - dormantDays * 24 * 60 * 60_000;
      const activity = await adapter.listActivity();
      let flagged = 0;
      for (const t of activity) {
        if (abortSignal.aborted) break;
        const lastMs = Date.parse(t.lastActiveAt);
        if (Number.isFinite(lastMs) && lastMs < cutoffMs) {
          await adapter.flagDormant(t.tenantId);
          flagged++;
        }
      }
      return {
        passId: PASS_ID,
        itemsProcessed: activity.length,
        itemsEmitted: flagged,
        notes: `flagged=${flagged} of ${activity.length} (cutoff ${dormantDays}d)`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
