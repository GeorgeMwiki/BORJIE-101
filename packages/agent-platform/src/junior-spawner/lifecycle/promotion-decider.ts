/**
 * Lifecycle promotion decider (Wave 18V-DYNAMIC).
 *
 * Pure decision function — given a junior's current state and its
 * usage + satisfaction stats, return the next lifecycle status (or
 * `null` if no transition fires this tick).
 *
 * Spec §3 + §7. Thresholds are passed in (per-tenant override),
 * never read from global constants.
 */

import {
  DEFAULT_LIFECYCLE_THRESHOLDS,
  type JuniorLifecycleStatus,
  type LifecycleThresholds,
  type PersistedJuniorRecord,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Stats input
// ─────────────────────────────────────────────────────────────────────

export interface PromotionStats {
  readonly usage_count: number;
  readonly avg_satisfaction: number | null;
  readonly sustained_days_at_target: number;
}

// ─────────────────────────────────────────────────────────────────────
// Outcome
// ─────────────────────────────────────────────────────────────────────

export type PromotionDecision =
  | { readonly kind: 'no_change'; readonly reason: string }
  | { readonly kind: 'promote'; readonly to: JuniorLifecycleStatus; readonly reason: string };

// ─────────────────────────────────────────────────────────────────────
// Decider
// ─────────────────────────────────────────────────────────────────────

/**
 * Decide whether to promote `junior` based on `stats`. Seed-provenance
 * juniors are never promoted (they bypass the lifecycle worker).
 */
export function decidePromotion(
  junior: PersistedJuniorRecord,
  stats: PromotionStats,
  thresholds: LifecycleThresholds = DEFAULT_LIFECYCLE_THRESHOLDS,
): PromotionDecision {
  if (junior.provenance === 'seed') {
    return { kind: 'no_change', reason: 'seed juniors bypass lifecycle' };
  }

  const status = junior.lifecycle_status;
  const sat = stats.avg_satisfaction ?? 0;

  if (status === 'draft') {
    return {
      kind: 'no_change',
      reason: 'draft juniors are promoted by first-use, not the worker',
    };
  }

  if (status === 'shadow') {
    if (
      stats.usage_count >= thresholds.shadow_to_live_min_uses &&
      sat >= thresholds.shadow_to_live_min_satisfaction
    ) {
      return {
        kind: 'promote',
        to: 'live',
        reason: `usage ${stats.usage_count} ≥ ${thresholds.shadow_to_live_min_uses} and satisfaction ${sat.toFixed(2)} ≥ ${thresholds.shadow_to_live_min_satisfaction}`,
      };
    }
    return {
      kind: 'no_change',
      reason: `shadow thresholds not yet met (uses ${stats.usage_count}, sat ${sat.toFixed(2)})`,
    };
  }

  if (status === 'live') {
    if (
      stats.usage_count >= thresholds.live_to_locked_min_uses &&
      sat >= thresholds.live_to_locked_min_satisfaction &&
      stats.sustained_days_at_target >= thresholds.live_to_locked_sustain_days
    ) {
      return {
        kind: 'promote',
        to: 'locked',
        reason: `sustained ${stats.sustained_days_at_target}d ≥ ${thresholds.live_to_locked_sustain_days}d at ${sat.toFixed(2)} satisfaction`,
      };
    }
    return {
      kind: 'no_change',
      reason: `live thresholds not yet met (uses ${stats.usage_count}, sat ${sat.toFixed(2)}, sustained ${stats.sustained_days_at_target}d)`,
    };
  }

  // locked + deprecated do not auto-promote
  return {
    kind: 'no_change',
    reason: `lifecycle_status='${status}' has no auto-promotion`,
  };
}

/**
 * Apply the inverse: should this junior fall into draft from being
 * unused? Not actually a promotion — exported here because the
 * promotion path needs to know what's already been escalated to the
 * draft-promotion handler.
 *
 * Returns true if `junior` is a `draft` that has now received its
 * first use (one or more uses) — caller flips to `shadow`.
 */
export function shouldPromoteDraftToShadow(
  junior: PersistedJuniorRecord,
): boolean {
  return junior.provenance !== 'seed' &&
    junior.lifecycle_status === 'draft' &&
    junior.usage_count >= 1;
}
