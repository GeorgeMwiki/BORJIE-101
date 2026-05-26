/**
 * PRM aggregator — confidence-weighted ensemble of multiple PRMs.
 *
 * Encodes the DeepSeek-R1 lesson from §2.2: a learned PRM weaker than
 * the policy will be reward-hacked. The aggregator therefore refuses to
 * vote-weight a learned signal whose confidence is below 0.6, and
 * always carries the heuristic baseline as a floor.
 */

import type { PrmFn, PrmInput, PrmOutput, PrmSignal } from '../types.js';

const LEARNED_CONFIDENCE_FLOOR = 0.6;

/**
 * Builds an aggregated PRM from a heuristic baseline + zero-or-more
 * candidate PRMs. Pure factory — no closure over mutable state.
 */
export function createAggregatorPrm(
  heuristic: PrmFn,
  candidates: ReadonlyArray<PrmFn>,
): PrmFn {
  return (input: PrmInput): PrmOutput => {
    const baseline = heuristic(input);
    const trusted = candidates
      .map((fn) => fn(input))
      .filter((out) => out.confidence >= LEARNED_CONFIDENCE_FLOOR);

    if (trusted.length === 0) {
      return baseline;
    }

    const totalConfidence =
      baseline.confidence +
      trusted.reduce((acc, out) => acc + out.confidence, 0);

    const weightedScore =
      (baseline.score * baseline.confidence +
        trusted.reduce((acc, out) => acc + out.score * out.confidence, 0)) /
      totalConfidence;

    const mergedSignals: ReadonlyArray<PrmSignal> = Object.freeze([
      ...baseline.signals,
      ...trusted.flatMap((out) => out.signals),
    ]);

    return Object.freeze({
      score: weightedScore,
      confidence: Math.min(1, totalConfidence / (1 + trusted.length)),
      signals: mergedSignals,
      explanation: `aggregated ${1 + trusted.length} PRM(s) — heuristic floor preserved`,
    });
  };
}

export const AGGREGATOR_LEARNED_CONFIDENCE_FLOOR = LEARNED_CONFIDENCE_FLOOR;
