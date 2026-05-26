/**
 * lock-decision — applies the spec §7 decision table for LOCK candidacy.
 *
 *   60-day first-submit acceptance rate > 80 %        → Lock candidate
 *   60-day revision rate                < 10 %        → Lock candidate
 *   regulator-flag count (30-day)       = 0           → Lock candidate
 *   ALL of the above sustained 90 consecutive days    → LOCK
 *
 * The "sustained 90 days" check is parameterised — the worker keeps a
 * rolling history of `lock_candidate` outcomes per recipe and asks this
 * module whether the candidacy has been continuous long enough.
 */

import type { LockDecision, RecipeFitnessStats } from '../types.js';

export interface LockDecisionInput {
  readonly stats: RecipeFitnessStats;
  readonly regulator_flag_count_30d: number;
  /** History of prior lock evaluations within the sustained window. */
  readonly candidate_streak_days: number;
  /** Spec defaults: 0.8, 0.1, 90. */
  readonly thresholds?: {
    readonly acceptance_threshold?: number;
    readonly revision_ceiling?: number;
    readonly sustained_days?: number;
  };
}

const DEFAULT_ACCEPTANCE = 0.8;
const DEFAULT_REVISION = 0.1;
const DEFAULT_SUSTAINED = 90;

export function decideLock(input: LockDecisionInput): LockDecision {
  const acceptanceThreshold =
    input.thresholds?.acceptance_threshold ?? DEFAULT_ACCEPTANCE;
  const revisionCeiling =
    input.thresholds?.revision_ceiling ?? DEFAULT_REVISION;
  const sustainedDays = input.thresholds?.sustained_days ?? DEFAULT_SUSTAINED;

  const reasons: string[] = [];

  if (input.stats.composition_count === 0) {
    return { kind: 'hold', reasons: ['no_compositions_in_window'] };
  }

  const acceptanceMet =
    input.stats.first_submit_acceptance_rate > acceptanceThreshold;
  const revisionMet = input.stats.revision_rate < revisionCeiling;
  const regulatorMet = input.regulator_flag_count_30d === 0;

  if (!acceptanceMet) {
    reasons.push(
      `acceptance_below_${acceptanceThreshold}:${input.stats.first_submit_acceptance_rate.toFixed(3)}`,
    );
  }
  if (!revisionMet) {
    reasons.push(
      `revision_above_${revisionCeiling}:${input.stats.revision_rate.toFixed(3)}`,
    );
  }
  if (!regulatorMet) {
    reasons.push(
      `regulator_flags_present:${input.regulator_flag_count_30d}`,
    );
  }

  if (reasons.length > 0) {
    return { kind: 'hold', reasons };
  }

  // All three checks pass — candidacy is established.
  reasons.push(
    `acceptance_above_${acceptanceThreshold}:${input.stats.first_submit_acceptance_rate.toFixed(3)}`,
    `revision_below_${revisionCeiling}:${input.stats.revision_rate.toFixed(3)}`,
    `regulator_flags_zero`,
  );

  if (input.candidate_streak_days >= sustainedDays) {
    return {
      kind: 'lock',
      reasons: [...reasons, `sustained_for_${input.candidate_streak_days}_days`],
    };
  }

  return {
    kind: 'lock_candidate',
    reasons: [
      ...reasons,
      `streak_${input.candidate_streak_days}_of_${sustainedDays}`,
    ],
  };
}
