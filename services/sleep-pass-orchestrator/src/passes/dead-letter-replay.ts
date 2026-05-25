/**
 * Sleep pass — replay dead-letter queue messages with bounded budget.
 */

import type { PassResult, SleepPass } from '../types.js';
import type { DeadLetterAdapter } from './adapters.js';

const PASS_ID = 'dead-letter-replay';
const DEFAULT_BATCH = 100;
const MAX_BATCH = 500;

export function createDeadLetterReplayPass(
  adapter: DeadLetterAdapter,
  batch = DEFAULT_BATCH,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      cadence: { kind: 'every-minutes', minutes: 15 },
      minIntervalMinutes: 10,
      priority: 2,
      maxDurationMs: 5 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      const cap = Math.min(batch, MAX_BATCH);
      const messages = await adapter.list({ limit: cap });
      let replayed = 0;
      let errored = 0;
      for (const msg of messages) {
        if (abortSignal.aborted) break;
        try {
          const { ok } = await adapter.replay(msg.id);
          if (ok) replayed++;
          else errored++;
        } catch {
          errored++;
        }
      }
      return {
        passId: PASS_ID,
        itemsProcessed: messages.length,
        itemsEmitted: replayed,
        notes: `replayed=${replayed} errored=${errored} of ${messages.length}`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
