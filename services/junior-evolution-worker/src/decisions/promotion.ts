/**
 * Promotion sweep (Wave 18V-DYNAMIC).
 *
 * For each junior visible across all tenants, fetch stats, run the
 * promotion decider, and apply the decision through the repository.
 *
 * Stub-level implementation — production wiring binds the real
 * Drizzle repositories. The pure decision function lives in
 * `@borjie/agent-platform/junior-spawner/lifecycle/promotion-decider`.
 */

import {
  decidePromotion,
  type AuditChainEmitter,
  type JuniorRepository,
  type LifecycleThresholds,
  type PersistedJuniorRecord,
  type PromotionStats,
} from '@borjie/agent-platform/junior-spawner';

export interface PromotionSweepDeps {
  readonly repository: JuniorRepository;
  readonly auditEmit: AuditChainEmitter;
  readonly statsFor: (junior: PersistedJuniorRecord) => Promise<PromotionStats>;
  readonly thresholds?: LifecycleThresholds;
  readonly now: () => Date;
}

export interface PromotionSweepResult {
  readonly considered: number;
  readonly promoted: number;
}

/**
 * Iterate every visible junior (caller filters by tenant outside) and
 * apply promotion decisions. Returns counts for logging / metrics.
 */
export async function runPromotionSweep(
  juniors: ReadonlyArray<PersistedJuniorRecord>,
  deps: PromotionSweepDeps,
): Promise<PromotionSweepResult> {
  let promoted = 0;

  for (const junior of juniors) {
    const stats = await deps.statsFor(junior);
    const decision = decidePromotion(junior, stats, deps.thresholds);
    if (decision.kind !== 'promote') continue;

    const now = deps.now();
    const updated = await deps.repository.setLifecycleStatus(
      junior.id,
      decision.to,
      now,
    );
    if (!updated) continue;

    await deps.auditEmit({
      kind: 'junior_lifecycle_transition',
      junior_id: junior.id,
      tenant_id: junior.tenant_id,
      provenance: junior.provenance,
      from_status: junior.lifecycle_status,
      to_status: decision.to,
      reason: decision.reason,
      at: now,
      actor: 'lifecycle-worker',
    });
    promoted += 1;
  }

  return { considered: juniors.length, promoted };
}
