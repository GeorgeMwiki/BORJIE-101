/**
 * Lifecycle deprecation decider (Wave 18V-DYNAMIC).
 *
 * Pure decision function — given a junior's stats, return whether
 * the worker should propose deprecation. Deprecation is always a
 * Tier-2 mutation (requires owner approval), so this decider only
 * proposes; the worker emits a mutation-authority proposal.
 *
 * Spec §7 — deprecation triggers:
 *   - sustained satisfaction < `deprecation_satisfaction_floor`
 *   - idle for ≥ `deprecation_idle_days`
 */

import {
  DEFAULT_LIFECYCLE_THRESHOLDS,
  type LifecycleThresholds,
  type PersistedJuniorRecord,
} from '../types.js';

export interface DeprecationStats {
  readonly avg_satisfaction: number | null;
  readonly idle_days: number;
}

export type DeprecationDecision =
  | { readonly kind: 'keep'; readonly reason: string }
  | { readonly kind: 'propose_deprecation'; readonly reason: string };

export function decideDeprecation(
  junior: PersistedJuniorRecord,
  stats: DeprecationStats,
  thresholds: LifecycleThresholds = DEFAULT_LIFECYCLE_THRESHOLDS,
): DeprecationDecision {
  if (junior.provenance === 'seed') {
    return { kind: 'keep', reason: 'seed juniors are never deprecated' };
  }
  if (junior.lifecycle_status === 'deprecated') {
    return { kind: 'keep', reason: 'already deprecated' };
  }
  if (junior.lifecycle_status === 'draft') {
    return { kind: 'keep', reason: 'drafts age out via promotion, not deprecation' };
  }

  const sat = stats.avg_satisfaction;
  if (sat !== null && sat < thresholds.deprecation_satisfaction_floor) {
    return {
      kind: 'propose_deprecation',
      reason: `sustained satisfaction ${sat.toFixed(2)} < floor ${thresholds.deprecation_satisfaction_floor}`,
    };
  }
  if (stats.idle_days >= thresholds.deprecation_idle_days) {
    return {
      kind: 'propose_deprecation',
      reason: `idle ${stats.idle_days}d ≥ ${thresholds.deprecation_idle_days}d`,
    };
  }
  return { kind: 'keep', reason: 'within healthy bounds' };
}
