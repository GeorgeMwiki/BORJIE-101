/**
 * Skill composer — aggregates observed step-sequences into a
 * candidate Skill once the threshold criteria are met
 * (≥SKILL_COMPOSE_MIN_INVOCATIONS executions AND
 * success_rate ≥ SKILL_PROMOTE_MIN_SUCCESS_RATE). Wave 18GG.
 *
 * Pure decider — no I/O.
 */

import {
  SKILL_COMPOSE_MIN_INVOCATIONS,
  SKILL_PROMOTE_MIN_SUCCESS_RATE,
  type SkillStatus,
} from '../types.js';

export interface SkillComposeDecision {
  readonly promote_to: SkillStatus;
  readonly reason:
    | 'below_invocation_threshold'
    | 'below_success_rate'
    | 'promote_to_tested'
    | 'promote_to_canonical';
}

export interface SkillObservationStats {
  readonly invocations: number;
  readonly success_rate: number;
  readonly current_status: SkillStatus;
}

export function decideSkillPromotion(
  stats: SkillObservationStats,
): SkillComposeDecision {
  if (stats.invocations < SKILL_COMPOSE_MIN_INVOCATIONS) {
    return {
      promote_to: stats.current_status,
      reason: 'below_invocation_threshold',
    };
  }
  if (stats.success_rate < SKILL_PROMOTE_MIN_SUCCESS_RATE) {
    return {
      promote_to: stats.current_status,
      reason: 'below_success_rate',
    };
  }
  // Tested skills with ≥3× the threshold invocations + sustained
  // success move to canonical. Below that, observed → tested.
  if (
    stats.current_status === 'tested' &&
    stats.invocations >= SKILL_COMPOSE_MIN_INVOCATIONS * 3
  ) {
    return { promote_to: 'canonical', reason: 'promote_to_canonical' };
  }
  if (stats.current_status === 'observed') {
    return { promote_to: 'tested', reason: 'promote_to_tested' };
  }
  return {
    promote_to: stats.current_status,
    reason: 'below_invocation_threshold',
  };
}

/**
 * Aggregates a list of observed `SkillStep` sequences into a single
 * canonical sequence when ≥`min_observations` of them match
 * step-for-step (same `tool_or_skill` per `seq`). Returns null when
 * no canonical sequence emerges.
 */
export function aggregateSkillSequences(
  observations: ReadonlyArray<ReadonlyArray<string>>,
  min_observations = SKILL_COMPOSE_MIN_INVOCATIONS,
): ReadonlyArray<string> | null {
  if (observations.length < min_observations) return null;

  const lengths = new Set(observations.map((o) => o.length));
  if (lengths.size !== 1) return null;

  const length = observations[0]?.length ?? 0;
  const canonical: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const samples = observations.map((o) => o[i] ?? '');
    const first = samples[0] ?? '';
    if (samples.some((s) => s !== first)) return null;
    canonical.push(first);
  }
  return canonical;
}
