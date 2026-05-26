/**
 * Promotion decider — pure function. Takes an `EvalRunPair` and a set of
 * `PromotionThresholds` and emits one of `promote | rollback | no-op`.
 *
 * Logic (spec §6):
 *   - rollback — any axis triggers its regression floor.
 *   - promote  — all four axes meet their improvement ceiling AND no
 *                axis triggers a rollback floor.
 *   - no-op    — otherwise (mixed / below significance).
 *
 * Convention recap:
 *   - WER / PER deltas: negative = improvement, positive = regression.
 *   - Grammar / terminology deltas: positive = improvement, negative =
 *     regression.
 */

import {
  DEFAULT_PROMOTION_THRESHOLDS,
  type EvalDelta,
  type PromotionDecision,
  type PromotionThresholds,
} from '../types.js';

export interface PromotionDecisionResult {
  readonly decision: PromotionDecision;
  readonly reason: string;
  readonly axesTriggeringRollback: ReadonlyArray<string>;
  readonly axesMeetingImprovement: ReadonlyArray<string>;
}

export function decidePromotion(
  delta: EvalDelta,
  thresholds: PromotionThresholds = DEFAULT_PROMOTION_THRESHOLDS,
): PromotionDecisionResult {
  const rollbackAxes: string[] = [];
  const improvementAxes: string[] = [];

  if (delta.wer >= thresholds.werRegressionFloor) {
    rollbackAxes.push('wer');
  } else if (delta.wer <= thresholds.werImprovementCeiling) {
    improvementAxes.push('wer');
  }

  if (delta.per >= thresholds.perRegressionFloor) {
    rollbackAxes.push('per');
  } else if (delta.per <= thresholds.perImprovementCeiling) {
    improvementAxes.push('per');
  }

  if (delta.grammar <= thresholds.grammarRegressionFloor) {
    rollbackAxes.push('grammar');
  } else if (delta.grammar >= thresholds.grammarImprovementCeiling) {
    improvementAxes.push('grammar');
  }

  if (delta.terminology <= thresholds.terminologyRegressionFloor) {
    rollbackAxes.push('terminology');
  } else if (delta.terminology >= thresholds.terminologyImprovementCeiling) {
    improvementAxes.push('terminology');
  }

  if (rollbackAxes.length > 0) {
    return Object.freeze({
      decision: 'rollback' as const,
      reason: `Regression detected on: ${rollbackAxes.join(', ')}`,
      axesTriggeringRollback: Object.freeze([...rollbackAxes]),
      axesMeetingImprovement: Object.freeze([...improvementAxes]),
    });
  }

  if (improvementAxes.length === 4) {
    return Object.freeze({
      decision: 'promote' as const,
      reason: 'All four axes (WER, PER, grammar, terminology) improved.',
      axesTriggeringRollback: Object.freeze([]),
      axesMeetingImprovement: Object.freeze([...improvementAxes]),
    });
  }

  return Object.freeze({
    decision: 'no-op' as const,
    reason: `Mixed signal — improvements on ${improvementAxes.length} of 4 axes; no rollback trigger.`,
    axesTriggeringRollback: Object.freeze([]),
    axesMeetingImprovement: Object.freeze([...improvementAxes]),
  });
}

/**
 * Significance gate — the runner consults this BEFORE consulting
 * `decidePromotion`. If the entry count per dialect bucket is below
 * `minEntriesPerDialect`, the decision is forced to `no-op`.
 */
export function checkSignificance(
  perDialectEntryCount: Readonly<Record<string, number>>,
  thresholds: PromotionThresholds = DEFAULT_PROMOTION_THRESHOLDS,
): { readonly significant: boolean; readonly insufficientDialects: ReadonlyArray<string> } {
  const insufficient: string[] = [];
  for (const [dialect, count] of Object.entries(perDialectEntryCount)) {
    if (count < thresholds.minEntriesPerDialect) {
      insufficient.push(dialect);
    }
  }
  return Object.freeze({
    significant: insufficient.length === 0,
    insufficientDialects: Object.freeze(insufficient),
  });
}
