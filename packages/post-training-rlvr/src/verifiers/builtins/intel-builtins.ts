/**
 * Intel-domain RLVR built-in verifiers (six total). Companions to
 * `calibration`, `citation-resolves`, `royalty-math`, `tra-schema`,
 * `brand-lock`, `mutation-authority`.
 *
 * Each verifier inspects a trace's `metadata` for an `intel_kind`
 * sentinel plus ground-truth fields the outcome-observer attached,
 * scores the call deterministically, and returns a clamped reward
 * in `[0, 1]`.
 *
 * - forecast-interval-coverage  — observed value ∈ predicted interval.
 *   Coverage scoring: Gneiting & Raftery, J. Amer. Statist. Assoc.
 *   102 (2007): 359–378.
 *   https://www.tandfonline.com/doi/abs/10.1198/016214506000001437
 * - stat-result-shape           — well-formed hypothesis-test result.
 * - graph-query-non-empty       — result non-empty AND shape matches.
 * - causal-refutation-stable    — ≥ 2 of 3 refutations stable. DoWhy:
 *   Sharma & Kıcıman, arXiv 2011.04216, 2020.
 *   https://arxiv.org/abs/2011.04216
 * - anomaly-precision-recall    — F1 ≥ floor. Görnitz et al., JAIR
 *   46 (2013): 235–262.
 *   https://www.jair.org/index.php/jair/article/view/10802
 * - recommendation-hit-rate     — ≥ 1 of top-K clicked. Cremonesi,
 *   Koren & Turrin, RecSys 2010.
 *   https://dl.acm.org/doi/10.1145/1864708.1864721
 *
 * Spec: Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md §5.
 *
 * @module @borjie/post-training-rlvr/verifiers/builtins/intel-builtins
 */

import type {
  RlvrTrace,
  Verifier,
  VerificationResult,
} from '../../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freezeResult(r: VerificationResult): VerificationResult {
  return Object.freeze({
    ...r,
    evidence: Object.freeze({ ...r.evidence }),
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function isIntelKind(meta: Record<string, unknown>, kind: string): boolean {
  return meta['intel_kind'] === kind;
}

// ---------------------------------------------------------------------------
// 1. forecast-interval-coverage
// ---------------------------------------------------------------------------

export function createForecastIntervalCoverageVerifier(): Verifier {
  return Object.freeze({
    name: 'forecast-interval-coverage',
    version: '1.0.0',
    applies(trace: RlvrTrace): boolean {
      const meta = trace.metadata as Record<string, unknown>;
      if (!isIntelKind(meta, 'forecast')) return false;
      return (
        typeof meta['interval_lower'] === 'number' &&
        typeof meta['interval_upper'] === 'number' &&
        typeof meta['observed_value'] === 'number'
      );
    },
    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const meta = trace.metadata as Record<string, unknown>;
      const lower = Number(meta['interval_lower']);
      const upper = Number(meta['interval_upper']);
      const observed = Number(meta['observed_value']);
      const claimed =
        typeof meta['claimed_coverage'] === 'number'
          ? Number(meta['claimed_coverage'])
          : 0.8;
      const inside = observed >= lower && observed <= upper;
      const reward = inside ? clamp01(claimed) : 0;
      const verdict: VerificationResult['verdict'] = inside ? 'pass' : 'fail';
      return freezeResult({
        verifierName: 'forecast-interval-coverage',
        verdict,
        reward,
        evidence: { lower, upper, observed, claimed, inside },
        confidence: 1,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// 2. stat-result-shape
// ---------------------------------------------------------------------------

export function createStatResultShapeVerifier(): Verifier {
  return Object.freeze({
    name: 'stat-result-shape',
    version: '1.0.0',
    applies(trace: RlvrTrace): boolean {
      const meta = trace.metadata as Record<string, unknown>;
      return isIntelKind(meta, 'stat');
    },
    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const meta = trace.metadata as Record<string, unknown>;
      const statistic = meta['statistic'];
      const pValue = meta['p_value'];
      const n = meta['n_observations'];
      const testName = meta['test_name'];

      const checks = {
        statistic_is_finite:
          typeof statistic === 'number' && Number.isFinite(statistic),
        pvalue_in_range:
          typeof pValue === 'number' &&
          Number.isFinite(pValue) &&
          pValue >= 0 &&
          pValue <= 1,
        n_observations_ok:
          typeof n === 'number' && Number.isFinite(n) && n >= 2,
        test_name_present:
          typeof testName === 'string' && testName.length > 0,
      };
      const passing = Object.values(checks).filter((v) => v).length;
      const total = Object.keys(checks).length;
      const reward = clamp01(passing / total);
      const verdict: VerificationResult['verdict'] =
        passing === total ? 'pass' : passing > 0 ? 'partial' : 'fail';
      return freezeResult({
        verifierName: 'stat-result-shape',
        verdict,
        reward,
        evidence: { checks, passing, total },
        confidence: 1,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// 3. graph-query-non-empty
// ---------------------------------------------------------------------------

export function createGraphQueryNonEmptyVerifier(): Verifier {
  return Object.freeze({
    name: 'graph-query-non-empty',
    version: '1.0.0',
    applies(trace: RlvrTrace): boolean {
      const meta = trace.metadata as Record<string, unknown>;
      return (
        isIntelKind(meta, 'graph_db') &&
        typeof meta['result_count'] === 'number'
      );
    },
    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const meta = trace.metadata as Record<string, unknown>;
      const count = Number(meta['result_count']);
      const expectedNonEmpty =
        typeof meta['expected_non_empty'] === 'boolean'
          ? Boolean(meta['expected_non_empty'])
          : true;
      const shapeMatches =
        typeof meta['shape_matches'] === 'boolean'
          ? Boolean(meta['shape_matches'])
          : true;
      const nonEmptyOk = expectedNonEmpty ? count > 0 : count === 0;
      const allOk = nonEmptyOk && shapeMatches;
      const reward = allOk ? 1 : nonEmptyOk || shapeMatches ? 0.5 : 0;
      const verdict: VerificationResult['verdict'] = allOk
        ? 'pass'
        : nonEmptyOk || shapeMatches
          ? 'partial'
          : 'fail';
      return freezeResult({
        verifierName: 'graph-query-non-empty',
        verdict,
        reward,
        evidence: { count, expectedNonEmpty, shapeMatches, allOk },
        confidence: 1,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// 4. causal-refutation-stable
// ---------------------------------------------------------------------------

export function createCausalRefutationStableVerifier(): Verifier {
  return Object.freeze({
    name: 'causal-refutation-stable',
    version: '1.0.0',
    applies(trace: RlvrTrace): boolean {
      const meta = trace.metadata as Record<string, unknown>;
      if (!isIntelKind(meta, 'causal')) return false;
      return (
        typeof meta['estimate'] === 'number' &&
        Array.isArray(meta['refutation_estimates'])
      );
    },
    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const meta = trace.metadata as Record<string, unknown>;
      const estimate = Number(meta['estimate']);
      const refutations = meta['refutation_estimates'] as ReadonlyArray<
        number
      >;
      const tolerance =
        typeof meta['tolerance'] === 'number'
          ? Number(meta['tolerance'])
          : 0.1;
      const denom = Math.max(1e-12, Math.abs(estimate));
      const stableCount = refutations.filter((r) => {
        if (!Number.isFinite(r)) return false;
        const rel = Math.abs(r - estimate) / denom;
        const abs = Math.abs(r - estimate);
        return rel <= tolerance || abs <= tolerance;
      }).length;
      const total = refutations.length;
      const requiredPass = Math.max(2, Math.ceil((total * 2) / 3));
      const ratio = total === 0 ? 0 : stableCount / total;
      const reward = clamp01(ratio);
      const verdict: VerificationResult['verdict'] =
        stableCount >= requiredPass
          ? 'pass'
          : stableCount > 0
            ? 'partial'
            : 'fail';
      return freezeResult({
        verifierName: 'causal-refutation-stable',
        verdict,
        reward,
        evidence: {
          estimate,
          refutations,
          stableCount,
          total,
          tolerance,
          requiredPass,
        },
        confidence: 1,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// 5. anomaly-precision-recall
// ---------------------------------------------------------------------------

export function createAnomalyPrecisionRecallVerifier(): Verifier {
  return Object.freeze({
    name: 'anomaly-precision-recall',
    version: '1.0.0',
    applies(trace: RlvrTrace): boolean {
      const meta = trace.metadata as Record<string, unknown>;
      if (!isIntelKind(meta, 'anomaly')) return false;
      return (
        typeof meta['true_positives'] === 'number' &&
        typeof meta['false_positives'] === 'number' &&
        typeof meta['false_negatives'] === 'number'
      );
    },
    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const meta = trace.metadata as Record<string, unknown>;
      const tp = Number(meta['true_positives']);
      const fp = Number(meta['false_positives']);
      const fn = Number(meta['false_negatives']);
      const floor =
        typeof meta['f1_floor'] === 'number'
          ? Number(meta['f1_floor'])
          : 0.7;
      const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
      const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
      const f1 =
        precision + recall === 0
          ? 0
          : (2 * precision * recall) / (precision + recall);
      const reward = clamp01(f1);
      const verdict: VerificationResult['verdict'] =
        f1 >= floor ? 'pass' : f1 > 0 ? 'partial' : 'fail';
      return freezeResult({
        verifierName: 'anomaly-precision-recall',
        verdict,
        reward,
        evidence: { tp, fp, fn, precision, recall, f1, floor },
        confidence: 1,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// 6. recommendation-hit-rate
// ---------------------------------------------------------------------------

export function createRecommendationHitRateVerifier(): Verifier {
  return Object.freeze({
    name: 'recommendation-hit-rate',
    version: '1.0.0',
    applies(trace: RlvrTrace): boolean {
      const meta = trace.metadata as Record<string, unknown>;
      if (!isIntelKind(meta, 'recommendation')) return false;
      return (
        typeof meta['top_k_clicked'] === 'number' &&
        typeof meta['k'] === 'number'
      );
    },
    async verify(trace: RlvrTrace): Promise<VerificationResult> {
      const meta = trace.metadata as Record<string, unknown>;
      const clicked = Number(meta['top_k_clicked']);
      const k = Math.max(1, Number(meta['k']));
      const hitRate = clamp01(clicked / k);
      const reward = clamp01(clicked > 0 ? Math.max(0.5, hitRate) : 0);
      const verdict: VerificationResult['verdict'] =
        clicked > 0 ? (hitRate >= 0.5 ? 'pass' : 'partial') : 'fail';
      return freezeResult({
        verifierName: 'recommendation-hit-rate',
        verdict,
        reward,
        evidence: { clicked, k, hitRate },
        confidence: 1,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Registry helper — register all six verifiers in one call.
// ---------------------------------------------------------------------------

export function createIntelBuiltinVerifiers(): ReadonlyArray<Verifier> {
  return Object.freeze([
    createForecastIntervalCoverageVerifier(),
    createStatResultShapeVerifier(),
    createGraphQueryNonEmptyVerifier(),
    createCausalRefutationStableVerifier(),
    createAnomalyPrecisionRecallVerifier(),
    createRecommendationHitRateVerifier(),
  ]);
}
