/**
 * Cutover gate — pure `evaluate(session, criteria) → CutoverResult`.
 *
 * AND-of-four criteria (per `.audit/litfin-sota-2026-05-23/
 * 10-outcome-as-a-service.md` §2.3):
 *
 *   1. agreement                >= minAgreementRate            (default 0.85)
 *   2. sampleSize               >= minSampleSize               (default 5000)
 *   3. criticalViolations       <= maxCriticalViolations       (default 0)
 *   4. confidenceCorrelation    >= minConfidenceCorrelation    (default 0.7)
 *
 * A failed criterion does NOT short-circuit — we always evaluate all
 * four and surface the observed value. Operators need to see the full
 * grid because "agreement 0.84 / corr 0.71 / sample 12000 / violations 0"
 * is qualitatively different from "agreement 0.51 / corr 0.10 /
 * sample 200 / violations 12".
 *
 * Sequoia-tracked: 85%+ cutover success when this gate is enforced vs
 * 5% direct-pilot baseline.
 *
 * Out of scope: stakeholder sign-off (the fifth Brightlume gate) is a
 * human/process concern, not a pure-scoring concern. The wire-side
 * orchestrator combines this gate's `approved` flag with the sign-off
 * record.
 */

import {
  computeAgreementRate,
  countCriticalViolations,
} from './agreement-scorer.js';
import { computeConfidenceCorrelation } from './calibration-scorer.js';
import {
  DEFAULT_CUTOVER_CRITERIA,
  type CutoverCriteria,
  type CutoverCriterionResult,
  type CutoverResult,
  type ShadowSession,
} from './types.js';

/**
 * Evaluate a shadow session against the cutover criteria.
 *
 * @param session    Immutable shadow-session snapshot.
 * @param criteria   Cutover thresholds (defaults to spec headline).
 * @returns          Full criterion grid + AND-combined `approved` flag.
 */
export function evaluate(
  session: ShadowSession,
  criteria: CutoverCriteria = DEFAULT_CUTOVER_CRITERIA,
): CutoverResult {
  const decisions = session.decisions;

  // Compute each criterion independently — no short-circuit, full grid.
  const agreementRate = computeAgreementRate(decisions, criteria.numericTolerance);
  const sampleSize = decisions.length;
  const violations = countCriticalViolations(decisions);
  const correlation = computeConfidenceCorrelation(decisions, criteria.numericTolerance);

  const agreement: CutoverCriterionResult = {
    passed: agreementRate >= criteria.minAgreementRate,
    observed: agreementRate,
    threshold: criteria.minAgreementRate,
    reason:
      agreementRate >= criteria.minAgreementRate
        ? `agreement ${formatRate(agreementRate)} >= ${formatRate(criteria.minAgreementRate)}`
        : `agreement ${formatRate(agreementRate)} < ${formatRate(criteria.minAgreementRate)}`,
  };

  const sampleSizeResult: CutoverCriterionResult = {
    passed: sampleSize >= criteria.minSampleSize,
    observed: sampleSize,
    threshold: criteria.minSampleSize,
    reason:
      sampleSize >= criteria.minSampleSize
        ? `sample-size ${sampleSize} >= ${criteria.minSampleSize}`
        : `sample-size ${sampleSize} < ${criteria.minSampleSize}`,
  };

  const criticalViolations: CutoverCriterionResult = {
    passed: violations <= criteria.maxCriticalViolations,
    observed: violations,
    threshold: criteria.maxCriticalViolations,
    reason:
      violations <= criteria.maxCriticalViolations
        ? `critical-violations ${violations} <= ${criteria.maxCriticalViolations}`
        : `critical-violations ${violations} > ${criteria.maxCriticalViolations}`,
  };

  const confidenceCorrelation: CutoverCriterionResult = {
    passed: correlation >= criteria.minConfidenceCorrelation,
    observed: correlation,
    threshold: criteria.minConfidenceCorrelation,
    reason:
      correlation >= criteria.minConfidenceCorrelation
        ? `confidence-correlation ${correlation.toFixed(4)} >= ${criteria.minConfidenceCorrelation}`
        : `confidence-correlation ${correlation.toFixed(4)} < ${criteria.minConfidenceCorrelation}`,
  };

  const approved =
    agreement.passed &&
    sampleSizeResult.passed &&
    criticalViolations.passed &&
    confidenceCorrelation.passed;

  return {
    approved,
    agreement,
    sampleSize: sampleSizeResult,
    criticalViolations,
    confidenceCorrelation,
    summary: buildSummary(approved, session, [
      agreement,
      sampleSizeResult,
      criticalViolations,
      confidenceCorrelation,
    ]),
  };
}

function formatRate(r: number): string {
  return `${(r * 100).toFixed(2)}%`;
}

function buildSummary(
  approved: boolean,
  session: ShadowSession,
  criteria: ReadonlyArray<CutoverCriterionResult>,
): string {
  const verdict = approved ? 'APPROVED' : 'BLOCKED';
  const failures = criteria.filter((c) => !c.passed).map((c) => c.reason);
  if (approved) {
    return `${verdict}: subMd=${session.subMd} tenant=${session.tenantId} — all 4 criteria passed`;
  }
  return `${verdict}: subMd=${session.subMd} tenant=${session.tenantId} — failed [${failures.join('; ')}]`;
}
