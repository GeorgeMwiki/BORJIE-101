/**
 * Significance gate — pure.
 *
 * Decides whether a CandidateSkill should be promoted to the registry.
 * Three conjunctive conditions (all must hold):
 *
 *   1. occurrences ≥ MIN_OCCURRENCES (default 5)
 *   2. successRate ≥ MIN_SUCCESS_RATE (default 0.85)
 *   3. χ² ≥ CHI_SQUARED_CRITICAL_95 (df=1, p<0.05) vs. null model of
 *      uniform-random tool sequencing.
 *
 * The χ² approximation:
 *
 *   Observed:  [successCount, failureCount]
 *   Expected:  under a null where this tool sequence is no better than
 *              an arbitrary random sequence, we'd expect each call to
 *              succeed at the baseline rate r0 = 0.5 (we assume zero prior
 *              information about *which* tool sequences should succeed).
 *
 *   χ² = Σ (O − E)² / E
 *      = (S − E_S)² / E_S + (F − E_F)² / E_F
 *
 *   E_S = N · r0, E_F = N · (1 − r0), N = S + F.
 *
 * This is the classic Pearson goodness-of-fit on a 1×2 table. We use it
 * because a skill that succeeds (say) 8/10 times when the baseline says
 * each step is essentially a coin-flip is meaningful evidence the
 * pattern is doing real work — not noise.
 *
 * `baselineSuccessRate` is exposed as an option so production can pass
 * in the observed tenant-average instead of the 0.5 default.
 */

import {
  type CandidateSkill,
  type PromotionDecision,
  CHI_SQUARED_CRITICAL_95,
  MIN_OCCURRENCES,
  MIN_SUCCESS_RATE,
} from './types.js';

export interface SignificanceGateOptions {
  /** Override the occurrence floor. Default: MIN_OCCURRENCES = 5. */
  readonly minOccurrences?: number;
  /** Override the success-rate floor (0..1). Default: 0.85. */
  readonly minSuccessRate?: number;
  /** Null-model success rate (0..1). Default: 0.5 (coin-flip). */
  readonly baselineSuccessRate?: number;
}

function chiSquared(
  successCount: number,
  failureCount: number,
  baselineRate: number,
): number {
  const total = successCount + failureCount;
  if (total === 0) return 0;
  const expectedSuccess = total * baselineRate;
  const expectedFailure = total * (1 - baselineRate);
  // Guard divide-by-zero when baseline is 0 or 1.
  if (expectedSuccess <= 0 || expectedFailure <= 0) return 0;
  const sObs = successCount - expectedSuccess;
  const fObs = failureCount - expectedFailure;
  return (sObs * sObs) / expectedSuccess + (fObs * fObs) / expectedFailure;
}

/**
 * Gate a single candidate. Returns a `PromotionDecision` regardless of
 * verdict so the caller (e.g. dashboards, the promoter) can audit *why*
 * a candidate was rejected.
 *
 * Pure — no I/O, no randomness, no globals.
 */
export function evaluateCandidate(
  candidate: CandidateSkill,
  options: SignificanceGateOptions = {},
): PromotionDecision {
  const minOccurrences = options.minOccurrences ?? MIN_OCCURRENCES;
  const minSuccessRate = options.minSuccessRate ?? MIN_SUCCESS_RATE;
  const baselineSuccessRate = options.baselineSuccessRate ?? 0.5;

  const total = candidate.successCount + candidate.failureCount;
  const successRate = total === 0 ? 0 : candidate.successCount / total;
  const stat = chiSquared(
    candidate.successCount,
    candidate.failureCount,
    baselineSuccessRate,
  );

  // Conjunctive: report the FIRST failing condition so the audit trail
  // captures the actual blocker, not a downstream symptom.
  if (candidate.occurrences < minOccurrences) {
    return {
      candidate,
      verdict: 'reject',
      reason: 'occurrences_below_threshold',
      chiSquared: stat,
      chiSquaredCritical: CHI_SQUARED_CRITICAL_95,
      successRate,
    };
  }

  if (successRate < minSuccessRate) {
    return {
      candidate,
      verdict: 'reject',
      reason: 'success_rate_below_threshold',
      chiSquared: stat,
      chiSquaredCritical: CHI_SQUARED_CRITICAL_95,
      successRate,
    };
  }

  if (stat < CHI_SQUARED_CRITICAL_95) {
    return {
      candidate,
      verdict: 'reject',
      reason: 'chi_squared_not_significant',
      chiSquared: stat,
      chiSquaredCritical: CHI_SQUARED_CRITICAL_95,
      successRate,
    };
  }

  return {
    candidate,
    verdict: 'promote',
    reason: 'significant',
    chiSquared: stat,
    chiSquaredCritical: CHI_SQUARED_CRITICAL_95,
    successRate,
  };
}

/** Convenience: evaluate a batch; preserve input order. */
export function evaluateCandidates(
  candidates: readonly CandidateSkill[],
  options: SignificanceGateOptions = {},
): readonly PromotionDecision[] {
  return candidates.map((c) => evaluateCandidate(c, options));
}
