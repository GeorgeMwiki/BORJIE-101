/**
 * Auto-promotion gate — translates Bayesian decision results into
 * promote / hold / abort verdicts. Honors recipe-level
 * `auto_promote_winner` and authority tier.
 */

import type { ABTestSpec, AuthorityTier } from '../types.js';
import type { DecisionResult } from './bayes-decider.js';

export type PromotionVerdict =
  | 'promote_auto'
  | 'promote_owner_approval_required'
  | 'hold_insufficient_data'
  | 'no_winner';

export interface PromotionDecision {
  readonly verdict: PromotionVerdict;
  readonly winner_variant_id: string | null;
  readonly posterior: number | null;
}

export interface DecideArgs {
  readonly spec: ABTestSpec;
  readonly authority_tier: AuthorityTier;
  readonly decisions: ReadonlyArray<DecisionResult>;
}

export function decidePromotion(args: DecideArgs): PromotionDecision {
  const winners = args.decisions.filter((d) => d.is_winner);
  if (winners.length === 0) {
    return {
      verdict: args.decisions.length === 0 ? 'hold_insufficient_data' : 'no_winner',
      winner_variant_id: null,
      posterior: null,
    };
  }
  // Pick the highest-posterior winner deterministically.
  const sorted = [...winners].sort((a, b) => b.bayes_posterior - a.bayes_posterior);
  const top = sorted[0];
  if (top === undefined) {
    return { verdict: 'hold_insufficient_data', winner_variant_id: null, posterior: null };
  }
  if (args.authority_tier === 2 || !args.spec.auto_promote_winner) {
    return {
      verdict: 'promote_owner_approval_required',
      winner_variant_id: top.variant_id,
      posterior: top.bayes_posterior,
    };
  }
  return {
    verdict: 'promote_auto',
    winner_variant_id: top.variant_id,
    posterior: top.bayes_posterior,
  };
}
