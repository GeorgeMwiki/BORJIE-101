/**
 * Reward shaper — combine per-verifier `VerificationResult[]` into a
 * single `RewardShape`. Skipped verifiers are excluded from the
 * aggregate; failures count as 0 but contribute their weight (so a
 * failing trace cannot inflate its average by skipping the verifier).
 *
 * Weights default to uniform (1.0 per verifier). Callers may supply a
 * `RewardWeights` map to lift / suppress specific verifiers.
 */

import type {
  RewardShape,
  RewardWeights,
  VerificationResult,
} from '../types.js';

export interface ShapeRewardInput {
  readonly traceId: string;
  readonly results: ReadonlyArray<VerificationResult>;
  readonly weights?: RewardWeights;
}

const clamp = (v: number): number => Math.max(0, Math.min(1, v));

export function shapeReward(input: ShapeRewardInput): RewardShape {
  const { traceId, results } = input;
  const weights = input.weights ?? {};

  let weightedSum = 0;
  let effectiveWeight = 0;
  let anyFail = false;

  for (const result of results) {
    if (result.verdict === 'skip') {
      continue;
    }
    const weight = weights[result.verifierName] ?? 1;
    if (weight <= 0) {
      continue;
    }
    weightedSum += clamp(result.reward) * weight;
    effectiveWeight += weight;
    if (result.verdict === 'fail') {
      anyFail = true;
    }
  }

  const aggregate = effectiveWeight === 0 ? 0 : weightedSum / effectiveWeight;

  return Object.freeze({
    traceId,
    perVerifier: Object.freeze([...results]),
    aggregate,
    effectiveWeight,
    anyFail,
  });
}
