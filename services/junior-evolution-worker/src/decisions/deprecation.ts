/**
 * Deprecation sweep (Wave 18V-DYNAMIC).
 *
 * Wraps the pure `decideDeprecation` function and emits a
 * mutation-authority proposal for each candidate. Stub-level — the
 * mutation-authority proposal emitter is bound by the composition
 * root in production; this module only formats the candidates.
 */

import {
  decideDeprecation,
  type AuditChainEmitter,
  type DeprecationStats,
  type JuniorRepository,
  type LifecycleThresholds,
  type PersistedJuniorRecord,
} from '@borjie/agent-platform/junior-spawner';

export interface DeprecationCandidate {
  readonly junior_id: string;
  readonly tenant_id: string | null;
  readonly reason: string;
}

export interface DeprecationSweepDeps {
  readonly repository: JuniorRepository;
  readonly auditEmit: AuditChainEmitter;
  readonly statsFor: (junior: PersistedJuniorRecord) => Promise<DeprecationStats>;
  readonly thresholds?: LifecycleThresholds;
  readonly now: () => Date;
}

export interface DeprecationSweepResult {
  readonly considered: number;
  readonly proposed: ReadonlyArray<DeprecationCandidate>;
}

/**
 * Iterate every visible junior, run the deprecation decider, and
 * collect candidates. We do NOT auto-flip to `deprecated` — that is
 * always a Tier-2 mutation requiring owner sign-off.
 */
export async function runDeprecationSweep(
  juniors: ReadonlyArray<PersistedJuniorRecord>,
  deps: DeprecationSweepDeps,
): Promise<DeprecationSweepResult> {
  const proposed: DeprecationCandidate[] = [];

  for (const junior of juniors) {
    const stats = await deps.statsFor(junior);
    const decision = decideDeprecation(junior, stats, deps.thresholds);
    if (decision.kind !== 'propose_deprecation') continue;

    proposed.push({
      junior_id: junior.id,
      tenant_id: junior.tenant_id,
      reason: decision.reason,
    });

    // Log the proposal into the audit chain — actual T2 staging is
    // delegated to the mutation-authority pipeline (bound at the
    // composition root).
    await deps.auditEmit({
      kind: 'junior_lifecycle_transition',
      junior_id: junior.id,
      tenant_id: junior.tenant_id,
      provenance: junior.provenance,
      from_status: junior.lifecycle_status,
      to_status: 'deprecated',
      reason: `[proposal] ${decision.reason}`,
      at: deps.now(),
      actor: 'lifecycle-worker',
    });
  }

  return { considered: juniors.length, proposed };
}
