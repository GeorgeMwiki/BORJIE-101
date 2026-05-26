/**
 * `promotion-decider.ts` — the 10× / 3-user promotion threshold.
 *
 * Pure decision function. Caller supplies a snapshot from the
 * reuse-counter (or from the telemetry-repository for the durable read);
 * decider returns whether to promote, and the deterministic promoted
 * recipe id.
 */
import type { ReuseSnapshot } from './reuse-counter.js';

export const PROMOTION_REUSE_THRESHOLD = 10;
export const PROMOTION_DISTINCT_USER_THRESHOLD = 3;

export type PromotionDecision =
  | { readonly should_promote: false }
  | {
      readonly should_promote: true;
      readonly promotion_recipe_id: string;
    };

/**
 * Pure decider. Takes the snapshot, the function id, the archetype, an
 * optional scope label, and an ISO date string (for the suffix). Returns
 * the decision.
 *
 * The threshold is met when **both** the total count and the distinct
 * user count clear their respective thresholds.
 */
export function decidePromotion(input: {
  readonly snapshot: ReuseSnapshot;
  readonly function_id: string;
  readonly archetype: string;
  readonly scope_label?: string;
  readonly date_iso?: string;
}): PromotionDecision {
  const { snapshot, function_id, archetype, scope_label } = input;
  if (
    snapshot.count < PROMOTION_REUSE_THRESHOLD ||
    snapshot.distinct_user_count < PROMOTION_DISTINCT_USER_THRESHOLD
  ) {
    return { should_promote: false };
  }

  const datePart = (input.date_iso ?? new Date().toISOString()).slice(0, 10);
  const scopePart = scope_label ?? 'global';
  const promotion_recipe_id =
    `${function_id}-${archetype}-${scopePart}-promoted-${datePart}`.toLowerCase();

  return { should_promote: true, promotion_recipe_id };
}
