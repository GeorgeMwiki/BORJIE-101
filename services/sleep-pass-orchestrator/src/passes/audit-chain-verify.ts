/**
 * Sleep pass — verify hash-chain integrity by recomputing every hash
 * and comparing with the stored value.
 *
 * NEVER mutates the chain. Emits a notes string summarising any breaks.
 */

import type { PassResult, SleepPass } from '../types.js';
import type { AuditChainAdapter } from './adapters.js';

const PASS_ID = 'audit-chain-verify';

export function createAuditChainVerifyPass(
  adapter: AuditChainAdapter,
): SleepPass {
  return {
    id: PASS_ID,
    schedule: {
      cadence: { kind: 'daily', hour: 2, minute: 0 },
      minIntervalMinutes: 60 * 20,
      priority: 1,
      maxDurationMs: 30 * 60_000,
    },
    async run({ abortSignal, now }): Promise<PassResult> {
      const startedAt = now().toISOString();
      const entries = await adapter.listAll();
      const breaks: string[] = [];
      let prevHash: string | null = null;
      for (const entry of entries) {
        if (abortSignal.aborted) break;
        if (entry.previousHash !== prevHash) {
          breaks.push(`prev-mismatch:${entry.id}`);
        }
        const expected = adapter.recomputeHash(entry);
        if (expected !== entry.hash) {
          breaks.push(`hash-mismatch:${entry.id}`);
        }
        prevHash = entry.hash;
      }
      return {
        passId: PASS_ID,
        itemsProcessed: entries.length,
        itemsEmitted: breaks.length,
        notes:
          breaks.length === 0
            ? `clean across ${entries.length} entries`
            : `BREAKS: ${breaks.slice(0, 5).join(', ')}`,
        startedAt,
        completedAt: now().toISOString(),
        aborted: abortSignal.aborted,
        errored: false,
      };
    },
  };
}
