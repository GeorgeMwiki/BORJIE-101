/**
 * Six RLVR built-in verifiers added by the intel-self-improve wave.
 *
 * Each implements the `Verifier` port from `@borjie/post-training-rlvr`
 * (see `packages/post-training-rlvr/src/types.ts`). The shape is the
 * same as the existing built-ins: `name`, `version`, `applies(trace)`,
 * `verify(trace) -> Promise<VerificationResult>`. Each verifier reads
 * the trace's `metadata` for the intel-kind sentinel and the ground-
 * truth fields the outcome-observer attached.
 *
 * Verifier names (table in spec §5):
 *
 *   - forecast-interval-coverage     : Gneiting & Raftery (2007).
 *                                      https://www.tandfonline.com/doi/abs/10.1198/016214506000001437
 *   - stat-result-shape              : well-formed `statistic` /
 *                                      `pValue` / `nObservations`.
 *   - graph-query-non-empty          : non-empty + schema match.
 *   - causal-refutation-stable       : ≥ 2 of 3 refutations within
 *                                      ±10 % (DoWhy, Sharma & Kıcıman,
 *                                      arXiv 2011.04216).
 *   - anomaly-precision-recall       : F1 ≥ 0.7 against labelled set.
 *                                      (Görnitz et al., JAIR 46 (2013).
 *                                      https://www.jair.org/index.php/jair/article/view/10802)
 *   - recommendation-hit-rate        : ≥ 1 of top-K clicked within
 *                                      feedback window. (Cremonesi,
 *                                      Koren & Turrin, RecSys 2010.
 *                                      https://dl.acm.org/doi/10.1145/1864708.1864721)
 *
 * Every verifier returns `verdict = 'skip'` when its required ground-
 * truth fields are absent (e.g. the forecast horizon has not been
 * reached). Every reward is clamped to `[0, 1]`.
 *
 * @module @borjie/intel-self-improve/verifiers/intel-builtins
 */

import type {
  RlvrTrace,
  VerificationResult,
  Verifier,
} from '@borjie/post-training-rlvr';
import type { IntelKind } from '../types.js';

const SKIP_NO_GROUND_TRUTH = 'no_ground_truth';

function freezeResult(r: VerificationResult): VerificationResult {
  return Object.freeze({
    ...r,
    evidence: Object.freeze({ ...r.evidence }),
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function intelKindOf(trace: RlvrTrace): IntelKind | null {
  const meta = trace.metadata as Record<string, unknown>;
  const k = meta['intel_kind'];
  if (typeof k !== 'string') return null;
  const allowed: ReadonlyArray<string> = [
    'forecast',
    'stat',
    'graph_db',
    'causal',
    'anomaly',
    'recommendation',
  ];
  return allowed.includes(k) ? (k as IntelKind) : null;
}

// ---------------------------------------------------------------------------
// 1. forecast-interval-coverage
//
// Gneiting & Raftery, "Strictly Proper Scoring Rules, Prediction, and
// Estimation", J. Amer. Statist. Assoc. 102 (2007): 359–378.
// https://www.tandfonline.com/doi/abs/10.1198/016214506000001437
// ---------------------------------------------------------------------------

export interface ForecastIntervalCoverageInputs {
  readonly observedValue: number;
  readonly interval80: { readonly lower: number; readonly upper: number };
  readonly interval95: { readonly lower: number; readonly upper: number };
}

function extractForecastInputs(
  trace: RlvrTrace,
): ForecastIntervalCoverageInputs | null {
  if (intelKindOf(trace) !== 'forecast') return null;
  const meta = trace.metadata as Record<string, unknown>;
  const obs = meta['observed_value'];
  const i80 = meta['interval_80'] as
    | { lower?: unknown; upper?: unknown }
    | undefined;
  const i95 = meta['interval_95'] as
    | { lower?: unknown; upper?: unknown }
    | undefined;
  if (typeof obs !== 'number' || !Number.isFinite(obs)) return null;
  if (!i80 || typeof i80.lower !== 'number' || typeof i80.upper !== 'number') {
    return null;
  }
  if (!i95 || typeof i95.lower !== 'number' || typeof i95.upper !== 'number') {
    return null;
  }
  return Object.freeze({
    observedValue: obs,
    interval80: Object.freeze({ lower: i80.lower, upper: i80.upper }),
    interval95: Object.freeze({ lower: i95.lower, upper: i95.upper }),
  });
}

export function createForecastIntervalCoverageVerifier(): Verifier {
  return {
    name: 'forecast-interval-coverage',
    version: '1.0.0',
    applies(trace) {
      return extractForecastInputs(trace) !== null;
    },
    async verify(trace) {
      const inputs = extractForecastInputs(trace);
      if (inputs === null) {
        return freezeResult({
          verifierName: 'forecast-interval-coverage',
          verdict: 'skip',
          reward: 0,
          evidence: { reason: SKIP_NO_GROUND_TRUTH },
          confidence: 0,
        });
      }
      const inside80 =
        inputs.observedValue >= inputs.interval80.lower &&
        inputs.observedValue <= inputs.interval80.upper;
      const inside95 =
        inputs.observedValue >= inputs.interval95.lower &&
        inputs.observedValue <= inputs.interval95.upper;
      const reward = clamp01(
        0.5 * (inside80 ? 1 : 0) + 0.5 * (inside95 ? 1 : 0),
      );
      const verdict: VerificationResult['verdict'] = inside95
        ? inside80
          ? 'pass'
          : 'partial'
        : 'fail';
      return freezeResult({
        verifierName: 'forecast-interval-coverage',
        verdict,
        reward,
        evidence: {
          observedValue: inputs.observedValue,
          interval80: inputs.interval80,
          interval95: inputs.interval95,
          inside80,
          inside95,
        },
        confidence: 1,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 2. stat-result-shape — well-formed t-test / chi-square / bootstrap result
// ---------------------------------------------------------------------------

export interface StatResultShapeInputs {
  readonly statistic: number;
  readonly pValue: number;
  readonly nObservations: number;
}

function extractStatInputs(trace: RlvrTrace): StatResultShapeInputs | null {
  if (intelKindOf(trace) !== 'stat') return null;
  const meta = trace.metadata as Record<string, unknown>;
  const stat = meta['statistic'];
  const p = meta['p_value'];
  const n = meta['n_observations'];
  if (typeof stat !== 'number' || !Number.isFinite(stat)) return null;
  if (typeof p !== 'number' || !Number.isFinite(p)) return null;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Object.freeze({ statistic: stat, pValue: p, nObservations: n });
}

export function createStatResultShapeVerifier(): Verifier {
  return {
    name: 'stat-result-shape',
    version: '1.0.0',
    applies(trace) {
      return intelKindOf(trace) === 'stat';
    },
    async verify(trace) {
      const inputs = extractStatInputs(trace);
      if (inputs === null) {
        return freezeResult({
          verifierName: 'stat-result-shape',
          verdict: 'skip',
          reward: 0,
          evidence: { reason: SKIP_NO_GROUND_TRUTH },
          confidence: 0,
        });
      }
      const pInRange = inputs.pValue >= 0 && inputs.pValue <= 1;
      const nPositive = inputs.nObservations > 0 && Number.isInteger(inputs.nObservations);
      const ok = pInRange && nPositive && Number.isFinite(inputs.statistic);
      return freezeResult({
        verifierName: 'stat-result-shape',
        verdict: ok ? 'pass' : 'fail',
        reward: ok ? 1 : 0,
        evidence: {
          statistic: inputs.statistic,
          pValue: inputs.pValue,
          nObservations: inputs.nObservations,
          pInRange,
          nPositive,
        },
        confidence: 1,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 3. graph-query-non-empty
// ---------------------------------------------------------------------------

export interface GraphQueryNonEmptyInputs {
  readonly resultCount: number;
  readonly expectedCardinality: 'non_empty' | 'allow_empty';
  readonly schemaMatch: boolean;
}

function extractGraphInputs(trace: RlvrTrace): GraphQueryNonEmptyInputs | null {
  if (intelKindOf(trace) !== 'graph_db') return null;
  const meta = trace.metadata as Record<string, unknown>;
  const count = meta['result_count'];
  const expected = meta['expected_cardinality'];
  const schemaMatch = meta['schema_match'];
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
    return null;
  }
  if (expected !== 'non_empty' && expected !== 'allow_empty') return null;
  if (typeof schemaMatch !== 'boolean') return null;
  return Object.freeze({
    resultCount: count,
    expectedCardinality: expected,
    schemaMatch,
  });
}

export function createGraphQueryNonEmptyVerifier(): Verifier {
  return {
    name: 'graph-query-non-empty',
    version: '1.0.0',
    applies(trace) {
      return intelKindOf(trace) === 'graph_db';
    },
    async verify(trace) {
      const inputs = extractGraphInputs(trace);
      if (inputs === null) {
        return freezeResult({
          verifierName: 'graph-query-non-empty',
          verdict: 'skip',
          reward: 0,
          evidence: { reason: SKIP_NO_GROUND_TRUTH },
          confidence: 0,
        });
      }
      const cardinalityOk =
        inputs.expectedCardinality === 'allow_empty' || inputs.resultCount > 0;
      const ok = cardinalityOk && inputs.schemaMatch;
      return freezeResult({
        verifierName: 'graph-query-non-empty',
        verdict: ok ? 'pass' : 'fail',
        reward: ok ? 1 : 0,
        evidence: {
          resultCount: inputs.resultCount,
          expectedCardinality: inputs.expectedCardinality,
          schemaMatch: inputs.schemaMatch,
          cardinalityOk,
        },
        confidence: 1,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 4. causal-refutation-stable
//
// DoWhy refutation framework — Sharma & Kıcıman, "DoWhy: An End-to-End
// Library for Causal Inference", arXiv 2011.04216, November 2020.
// https://arxiv.org/abs/2011.04216
// ---------------------------------------------------------------------------

export interface CausalRefutationInputs {
  readonly pointEstimate: number;
  readonly refutationEstimates: ReadonlyArray<number>;
  readonly toleranceRatio: number;
}

function extractCausalInputs(trace: RlvrTrace): CausalRefutationInputs | null {
  if (intelKindOf(trace) !== 'causal') return null;
  const meta = trace.metadata as Record<string, unknown>;
  const point = meta['point_estimate'];
  const refs = meta['refutation_estimates'];
  const tol = meta['tolerance_ratio'];
  if (typeof point !== 'number' || !Number.isFinite(point)) return null;
  if (!Array.isArray(refs) || refs.length === 0) return null;
  const numeric: Array<number> = [];
  for (const v of refs) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    numeric.push(v);
  }
  const tolerance =
    typeof tol === 'number' && Number.isFinite(tol) && tol > 0 ? tol : 0.1;
  return Object.freeze({
    pointEstimate: point,
    refutationEstimates: Object.freeze(numeric),
    toleranceRatio: tolerance,
  });
}

export function createCausalRefutationStableVerifier(): Verifier {
  return {
    name: 'causal-refutation-stable',
    version: '1.0.0',
    applies(trace) {
      return intelKindOf(trace) === 'causal';
    },
    async verify(trace) {
      const inputs = extractCausalInputs(trace);
      if (inputs === null) {
        return freezeResult({
          verifierName: 'causal-refutation-stable',
          verdict: 'skip',
          reward: 0,
          evidence: { reason: SKIP_NO_GROUND_TRUTH },
          confidence: 0,
        });
      }
      const denom = Math.abs(inputs.pointEstimate);
      const stable = inputs.refutationEstimates.filter((v) => {
        if (denom === 0) return Math.abs(v) <= inputs.toleranceRatio;
        return Math.abs(v - inputs.pointEstimate) / denom <= inputs.toleranceRatio;
      });
      const stableCount = stable.length;
      const total = inputs.refutationEstimates.length;
      const passes = stableCount >= 2 && total >= 2;
      const reward = clamp01(stableCount / Math.max(total, 1));
      const verdict: VerificationResult['verdict'] = passes
        ? 'pass'
        : stableCount > 0
          ? 'partial'
          : 'fail';
      return freezeResult({
        verifierName: 'causal-refutation-stable',
        verdict,
        reward,
        evidence: {
          pointEstimate: inputs.pointEstimate,
          refutationEstimates: inputs.refutationEstimates,
          toleranceRatio: inputs.toleranceRatio,
          stableCount,
          total,
        },
        confidence: 1,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 5. anomaly-precision-recall
//
// F1 score over labelled-anomaly evaluation set.
// Görnitz et al., "Toward Supervised Anomaly Detection", JAIR 46 (2013).
// https://www.jair.org/index.php/jair/article/view/10802
// ---------------------------------------------------------------------------

export interface AnomalyPrecisionRecallInputs {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
}

function extractAnomalyInputs(
  trace: RlvrTrace,
): AnomalyPrecisionRecallInputs | null {
  if (intelKindOf(trace) !== 'anomaly') return null;
  const meta = trace.metadata as Record<string, unknown>;
  const tp = meta['true_positives'];
  const fp = meta['false_positives'];
  const fn = meta['false_negatives'];
  if (typeof tp !== 'number' || tp < 0 || !Number.isInteger(tp)) return null;
  if (typeof fp !== 'number' || fp < 0 || !Number.isInteger(fp)) return null;
  if (typeof fn !== 'number' || fn < 0 || !Number.isInteger(fn)) return null;
  return Object.freeze({ truePositives: tp, falsePositives: fp, falseNegatives: fn });
}

export function createAnomalyPrecisionRecallVerifier(): Verifier {
  return {
    name: 'anomaly-precision-recall',
    version: '1.0.0',
    applies(trace) {
      return intelKindOf(trace) === 'anomaly';
    },
    async verify(trace) {
      const inputs = extractAnomalyInputs(trace);
      if (inputs === null) {
        return freezeResult({
          verifierName: 'anomaly-precision-recall',
          verdict: 'skip',
          reward: 0,
          evidence: { reason: SKIP_NO_GROUND_TRUTH },
          confidence: 0,
        });
      }
      const { truePositives: tp, falsePositives: fp, falseNegatives: fn } = inputs;
      const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
      const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
      const f1 =
        precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
      const reward = clamp01(f1);
      const verdict: VerificationResult['verdict'] = f1 >= 0.7 ? 'pass' : f1 > 0 ? 'partial' : 'fail';
      return freezeResult({
        verifierName: 'anomaly-precision-recall',
        verdict,
        reward,
        evidence: {
          truePositives: tp,
          falsePositives: fp,
          falseNegatives: fn,
          precision,
          recall,
          f1,
        },
        confidence: 1,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// 6. recommendation-hit-rate
//
// Cremonesi, Koren & Turrin, "Performance of recommender algorithms on
// top-n recommendation tasks", ACM RecSys 2010.
// https://dl.acm.org/doi/10.1145/1864708.1864721
// ---------------------------------------------------------------------------

export interface RecommendationHitRateInputs {
  readonly topK: ReadonlyArray<string>;
  readonly clickedItemIds: ReadonlyArray<string>;
}

function extractRecommendationInputs(
  trace: RlvrTrace,
): RecommendationHitRateInputs | null {
  if (intelKindOf(trace) !== 'recommendation') return null;
  const meta = trace.metadata as Record<string, unknown>;
  const top = meta['top_k'];
  const clicks = meta['clicked_item_ids'];
  if (!Array.isArray(top) || top.length === 0) return null;
  if (!Array.isArray(clicks)) return null;
  for (const v of top) if (typeof v !== 'string') return null;
  for (const v of clicks) if (typeof v !== 'string') return null;
  return Object.freeze({
    topK: Object.freeze([...top] as ReadonlyArray<string>),
    clickedItemIds: Object.freeze([...clicks] as ReadonlyArray<string>),
  });
}

export function createRecommendationHitRateVerifier(): Verifier {
  return {
    name: 'recommendation-hit-rate',
    version: '1.0.0',
    applies(trace) {
      return intelKindOf(trace) === 'recommendation';
    },
    async verify(trace) {
      const inputs = extractRecommendationInputs(trace);
      if (inputs === null) {
        return freezeResult({
          verifierName: 'recommendation-hit-rate',
          verdict: 'skip',
          reward: 0,
          evidence: { reason: SKIP_NO_GROUND_TRUTH },
          confidence: 0,
        });
      }
      const topSet = new Set(inputs.topK);
      const hits = inputs.clickedItemIds.filter((id) => topSet.has(id));
      const hit = hits.length >= 1;
      const reward = clamp01(hit ? 1 : 0);
      return freezeResult({
        verifierName: 'recommendation-hit-rate',
        verdict: hit ? 'pass' : 'fail',
        reward,
        evidence: {
          topK: inputs.topK,
          clickedItemIds: inputs.clickedItemIds,
          hits,
          hitCount: hits.length,
        },
        confidence: 1,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience — all six in deterministic order
// ---------------------------------------------------------------------------

export function createAllIntelVerifiers(): ReadonlyArray<Verifier> {
  return Object.freeze([
    createForecastIntervalCoverageVerifier(),
    createStatResultShapeVerifier(),
    createGraphQueryNonEmptyVerifier(),
    createCausalRefutationStableVerifier(),
    createAnomalyPrecisionRecallVerifier(),
    createRecommendationHitRateVerifier(),
  ]);
}
