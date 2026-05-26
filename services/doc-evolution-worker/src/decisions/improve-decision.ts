/**
 * improve-decision — applies the spec §7 decision table for IMPROVE.
 *
 *   60-day acceptance rate    < 50 %                 → Improve
 *   revision rate by section  > 20 %                 → Improve
 *   any regulator flag         present                → Improve
 *
 * Any single trigger is enough to fire — these are OR-joined per spec.
 * Locked recipes refuse all improve signals (the worker filters them
 * out before calling this).
 */

import type { ImproveDecision, RecipeFitnessStats } from '../types.js';

export interface ImproveDecisionInput {
  readonly stats: RecipeFitnessStats;
  readonly regulator_flag_count_30d: number;
  readonly thresholds?: {
    readonly acceptance_ceiling?: number;
    readonly section_revision_threshold?: number;
  };
}

const DEFAULT_ACCEPTANCE_CEILING = 0.5;
const DEFAULT_SECTION_REVISION = 0.2;

export function decideImprove(
  input: ImproveDecisionInput,
): ImproveDecision {
  if (input.stats.composition_count === 0) {
    return { kind: 'hold', reasons: ['no_compositions_in_window'] };
  }

  const acceptanceCeiling =
    input.thresholds?.acceptance_ceiling ?? DEFAULT_ACCEPTANCE_CEILING;
  const sectionRevisionThreshold =
    input.thresholds?.section_revision_threshold ?? DEFAULT_SECTION_REVISION;

  const reasons: string[] = [];

  if (input.stats.first_submit_acceptance_rate < acceptanceCeiling) {
    reasons.push(
      `acceptance_below_${acceptanceCeiling}:${input.stats.first_submit_acceptance_rate.toFixed(3)}`,
    );
  }

  for (const sec of input.stats.section_revision_rates) {
    if (sec.revision_rate > sectionRevisionThreshold) {
      reasons.push(
        `section_revision_above_${sectionRevisionThreshold}:${sec.section_path}=${sec.revision_rate.toFixed(3)}`,
      );
    }
  }

  if (input.regulator_flag_count_30d > 0) {
    reasons.push(`regulator_flag_present:${input.regulator_flag_count_30d}`);
  }

  if (reasons.length === 0) {
    return { kind: 'hold', reasons: ['all_thresholds_satisfied'] };
  }

  return { kind: 'improve', reasons };
}

/**
 * Return the section paths that exceed the section revision threshold —
 * passed to the LLM proposal generator as targeted rewrite candidates.
 */
export function targetedSectionsForImprove(
  stats: RecipeFitnessStats,
  threshold: number = DEFAULT_SECTION_REVISION,
): ReadonlyArray<string> {
  return stats.section_revision_rates
    .filter((s) => s.revision_rate > threshold)
    .map((s) => s.section_path);
}
