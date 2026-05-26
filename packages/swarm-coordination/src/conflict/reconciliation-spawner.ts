/**
 * Reconciliation spawner.
 *
 * Wave 18HH. When the conflict-detector opens a
 * `coordination_conflicts` row, this module spawns the dedicated
 * cognitive-engine reconciliation turn. The Wave 18T cognitive
 * engine is injected as a `ReconciliationKernel` port — this
 * package does not depend on cognitive-engine at the type level
 * (avoids a cycle), so the runtime wiring lives in the
 * persona-runtime composition root.
 *
 * The spawner is responsible for:
 *   1. Calling the kernel with the conflict payload.
 *   2. Inspecting the kernel's proposed tier.
 *   3. Auto-applying Tier-0 reconciliations; surfacing Tier 1+.
 *   4. Marking the conflict resolved via the conflicts-repository.
 */

import type {
  ConflictsRepository,
  CoordinationConflict,
  ConflictResolutionKind,
} from '../types.js';

/**
 * The conflict-reconciliation kernel port. The cognitive-engine
 * package implements this; the swarm-coordination package consumes
 * it as an interface only.
 */
export interface ReconciliationKernel {
  reconcile(args: {
    readonly tenantId: string;
    readonly conflict: CoordinationConflict;
  }): Promise<ReconciliationKernelOutput>;
}

export interface ReconciliationKernelOutput {
  /** 0 = Tier 0 data interpretation; 1+ = surface to owner. */
  readonly tier: number;
  readonly reconciliationPayload: Readonly<Record<string, unknown>>;
  /** Auto-resolved by AI at Tier 0; else 'owner_picked'/'both_rejected'. */
  readonly suggestedResolutionKind: ConflictResolutionKind;
}

export interface ReconciliationSpawnerDeps {
  readonly kernel: ReconciliationKernel;
  readonly repository: ConflictsRepository;
}

export interface ReconciliationSpawnResult {
  readonly resolved: boolean;
  readonly tier: number;
  readonly resolutionKind: ConflictResolutionKind | null;
  readonly surfacedToOwner: boolean;
}

export function createReconciliationSpawner(
  deps: ReconciliationSpawnerDeps,
): {
  spawn(
    tenantId: string,
    conflict: CoordinationConflict,
  ): Promise<ReconciliationSpawnResult>;
} {
  return {
    async spawn(tenantId, conflict) {
      const kernelOutput = await deps.kernel.reconcile({
        tenantId,
        conflict,
      });

      // Tier 0: silent auto-resolve. Tier 1+: surface to owner.
      if (kernelOutput.tier === 0) {
        await deps.repository.resolve(
          tenantId,
          conflict.id,
          'ai_reconciled',
          kernelOutput.reconciliationPayload,
        );
        return Object.freeze({
          resolved: true,
          tier: 0,
          resolutionKind: 'ai_reconciled' as const,
          surfacedToOwner: false,
        });
      }

      // Tier 1+: leave unresolved; persist the reconciliation
      // payload so the owner UI can render "A vs B vs reconciliation".
      // The actual `resolve()` call happens when the owner picks.
      return Object.freeze({
        resolved: false,
        tier: kernelOutput.tier,
        resolutionKind: null,
        surfacedToOwner: true,
      });
    },
  };
}
