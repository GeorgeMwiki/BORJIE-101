/**
 * Promotion decider — pure function on before/after deltas + prior
 * decision.
 *
 * The decision matrix (Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md §2.5):
 *
 *   - promote   iff Δ ≥ τ_promote
 *   - demote    iff Δ ≤ -τ_demote
 *   - rollback  iff previous decision was 'promote' and Δ ≤ -τ_demote
 *   - no-op     otherwise
 *
 * Pure function — no I/O, no global state.
 */

import type { Decision, PromotionDeciderConfig } from '../types.js';
import { DEFAULT_DECIDER_CONFIG } from '../types.js';

export interface DecideInput {
  readonly evalMetricBefore: number;
  readonly evalMetricAfter: number;
  readonly previousDecision: Decision | null;
  readonly config?: PromotionDeciderConfig;
}

export interface DecideOutcome {
  readonly decision: Decision;
  readonly delta: number;
  readonly reason: string;
}

export function decidePromotion(input: DecideInput): DecideOutcome {
  const config = input.config ?? DEFAULT_DECIDER_CONFIG;
  const delta = input.evalMetricAfter - input.evalMetricBefore;

  // Rollback takes precedence over plain demote when the previous
  // run was a promotion and this run regressed.
  if (
    input.previousDecision === 'promote' &&
    delta <= -config.demoteThreshold
  ) {
    return Object.freeze({
      decision: 'rollback' as Decision,
      delta,
      reason: `previous promote regressed by ${delta.toFixed(4)} ≤ -${config.demoteThreshold}`,
    });
  }

  if (delta >= config.promoteThreshold) {
    return Object.freeze({
      decision: 'promote' as Decision,
      delta,
      reason: `Δ=${delta.toFixed(4)} ≥ ${config.promoteThreshold}`,
    });
  }

  if (delta <= -config.demoteThreshold) {
    return Object.freeze({
      decision: 'demote' as Decision,
      delta,
      reason: `Δ=${delta.toFixed(4)} ≤ -${config.demoteThreshold}`,
    });
  }

  return Object.freeze({
    decision: 'no-op' as Decision,
    delta,
    reason: `Δ=${delta.toFixed(4)} within bounds`,
  });
}
