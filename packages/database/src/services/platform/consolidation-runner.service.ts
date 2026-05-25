/**
 * Consolidation runner adapter — backs the HQ-tier
 * `platform.run_consolidation_tick` tool (Central Command Phase B — B1,
 * TIER 2).
 *
 * Port over the consolidation-worker's `runOnce()` API. The worker
 * exposes its public surface in `services/consolidation-worker/src/index.ts`.
 * Composition root decides whether to call it in-process (preferred when
 * the api-gateway and consolidation-worker share a runtime) or over an
 * HTTP endpoint (when they're split).
 *
 * Rollback contract: when the worker writes a snapshot (`snapshotId`),
 * `rollbackToSnapshot()` reverts the post-tick semantic facts +
 * reflective digests back to the pre-tick state. The actual worker is
 * responsible for the rollback semantics; this adapter just routes
 * the call.
 */

import { logger } from '../../logger.js';
export interface ConsolidationTickReport {
  readonly tickId: string;
  readonly tenantId: string | null;
  readonly applied: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly factsExtracted: number;
  readonly patternsDetected: number;
  readonly digestsWritten: number;
  readonly decayedEntries: number;
  readonly snapshotId: string | null;
}

export interface ConsolidationRunArgs {
  readonly tenantId: string | null;
  readonly dryRun: boolean;
}

export interface ConsolidationRunnerService {
  runTick(args: ConsolidationRunArgs): Promise<ConsolidationTickReport>;
  rollbackToSnapshot(snapshotId: string): Promise<void>;
}

/**
 * Structural port for the consolidation-worker. Composition root wires
 * whichever implementation is available — in-process call OR HTTP call.
 */
export interface ConsolidationWorkerLike {
  runOnce(args: {
    readonly tenantId: string | null;
    readonly dryRun: boolean;
  }): Promise<ConsolidationTickReport>;
  rollbackSnapshot(snapshotId: string): Promise<void>;
}

export function createConsolidationRunnerService(
  worker: ConsolidationWorkerLike,
): ConsolidationRunnerService {
  return {
    async runTick(args) {
      try {
        const report = await worker.runOnce({
          tenantId: args.tenantId,
          dryRun: args.dryRun,
        });
        return report;
      } catch (error) {
        logger.error('platform.consolidation.runTick failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.consolidation.runTick failed');
      }
    },
    async rollbackToSnapshot(snapshotId) {
      try {
        if (!snapshotId) {
          throw new Error(
            'platform.consolidation.rollbackToSnapshot: snapshotId is required',
          );
        }
        await worker.rollbackSnapshot(snapshotId);
      } catch (error) {
        logger.error('platform.consolidation.rollbackToSnapshot failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('platform.consolidation.rollbackToSnapshot failed');
      }
    },
  };
}
