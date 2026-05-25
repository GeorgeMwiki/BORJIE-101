/**
 * Committer — applies the captured ProposedChange to live data.
 *
 * The engine has no opinion on WHERE that live data lives. Each
 * workflow kind registers a `ChangeApplier` that knows how to write
 * its specific entity (parcel, photo, lease, etc.). On approval the
 * engine resolves the applier for the kind, hands it the proposed
 * change, and writes the committed event on success — or rolls the run
 * to `rejected` on failure.
 *
 * Idempotency:
 *   - `applyProposedChange` MUST be safe to retry — appliers receive
 *     the run's `id` and `proposedChange.id` for dedupe.
 */

import type {
  ProposedChange,
  WorkflowDefinition,
  WorkflowKind,
  WorkflowRun,
} from '../types.js';

export interface ChangeApplyOutcome {
  readonly success: boolean;
  readonly error?: string;
  readonly applierDetails?: Readonly<Record<string, unknown>>;
}

export interface ChangeApplier {
  readonly kind: WorkflowKind;
  apply(input: {
    readonly run: WorkflowRun;
    readonly definition: WorkflowDefinition;
    readonly proposedChange: ProposedChange;
  }): Promise<ChangeApplyOutcome>;
}

export interface Committer {
  register(applier: ChangeApplier): void;
  applyProposedChange(input: {
    readonly run: WorkflowRun;
    readonly definition: WorkflowDefinition;
    readonly proposedChange: ProposedChange;
  }): Promise<ChangeApplyOutcome>;
}

export function createCommitter(
  initialAppliers: ReadonlyArray<ChangeApplier> = [],
): Committer {
  const map = new Map<WorkflowKind, ChangeApplier>();
  for (const a of initialAppliers) map.set(a.kind, a);

  return {
    register(applier) {
      map.set(applier.kind, applier);
    },
    async applyProposedChange({ run, definition, proposedChange }) {
      const applier = map.get(definition.kind);
      if (!applier) {
        return Object.freeze({
          success: false,
          error: `no_applier_registered_for_kind:${definition.kind}`,
        });
      }
      try {
        return await applier.apply({ run, definition, proposedChange });
      } catch (err) {
        return Object.freeze({
          success: false,
          error: `applier_threw:${(err as Error).message}`,
        });
      }
    },
  };
}

/**
 * Convenience: a noop applier set used in tests + dev. Records the
 * apply call in `applierDetails` for assertion purposes.
 *
 * `calls` is the live recording array (typed as ReadonlyArray to discourage
 * external mutation). Returning the live reference — rather than a frozen
 * snapshot via a getter — keeps the API ergonomic under destructuring
 * (`const { applier, calls } = createRecordingApplier(...)` would otherwise
 * capture an empty frozen array at destructuring time).
 */
export function createRecordingApplier(kind: WorkflowKind): {
  readonly applier: ChangeApplier;
  readonly calls: ReadonlyArray<{
    readonly runId: string;
    readonly proposedChangeId: string;
  }>;
} {
  const recorded: Array<{ runId: string; proposedChangeId: string }> = [];
  const applier: ChangeApplier = {
    kind,
    async apply({ run, proposedChange }) {
      recorded.push({ runId: run.id, proposedChangeId: proposedChange.id });
      return Object.freeze({
        success: true,
        applierDetails: { applied: true },
      });
    },
  };
  return {
    applier,
    calls: recorded,
  };
}
