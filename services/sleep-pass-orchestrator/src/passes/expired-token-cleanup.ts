/**
 * Sleep pass — purge expired sessions/tokens/api-keys/magic-links.
 */

import type { PassResult, SleepPass } from '../types.js';
import type { TokenAdapter } from './adapters.js';

const PASS_ID = 'expired-token-cleanup';

export function createExpiredTokenCleanupPass(
  adapter: TokenAdapter,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      cadence: { kind: 'every-minutes', minutes: 30 },
      minIntervalMinutes: 20,
      priority: 3,
      maxDurationMs: 2 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      const expired = await adapter.listExpired({ nowMs: now().getTime() });
      let purged = 0;
      for (const t of expired) {
        if (abortSignal.aborted) break;
        await adapter.purge(t.id);
        purged++;
      }
      return {
        passId: PASS_ID,
        itemsProcessed: expired.length,
        itemsEmitted: purged,
        notes: `purged=${purged} of ${expired.length}`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
