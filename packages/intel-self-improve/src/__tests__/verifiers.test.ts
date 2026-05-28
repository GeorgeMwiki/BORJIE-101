/**
 * RLVR built-in verifier smoke tests — each verifier scores a known
 * trace correctly.
 */

import { describe, it, expect } from 'vitest';

import type { RlvrTrace } from '@borjie/post-training-rlvr';

import {
  createAnomalyPrecisionRecallVerifier,
  createCausalRefutationStableVerifier,
  createForecastIntervalCoverageVerifier,
  createGraphQueryNonEmptyVerifier,
  createIntelBuiltinVerifiers,
  createRecommendationHitRateVerifier,
  createStatResultShapeVerifier,
} from '../index.js';

function makeTrace(metadata: Record<string, unknown>): RlvrTrace {
  return Object.freeze({
    id: 'tr-1',
    runId: 'run-1',
    tenantId: 'tenant-A',
    prompt: 'p',
    completion: 'c',
    toolCalls: Object.freeze([]),
    metadata: Object.freeze(metadata),
    capturedAt: '2024-05-26T00:00:00.000Z',
  });
}

describe('forecast-interval-coverage', () => {
  it('passes when observation inside interval', async () => {
    const v = createForecastIntervalCoverageVerifier();
    const trace = makeTrace({
      intel_kind: 'forecast',
      interval_lower: 0,
      interval_upper: 10,
      observed_value: 5,
      claimed_coverage: 0.8,
    });
    expect(v.applies(trace)).toBe(true);
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBeCloseTo(0.8, 6);
  });

  it('fails when observation outside interval', async () => {
    const v = createForecastIntervalCoverageVerifier();
    const trace = makeTrace({
      intel_kind: 'forecast',
      interval_lower: 0,
      interval_upper: 10,
      observed_value: 50,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('fail');
    expect(result.reward).toBe(0);
  });
});

describe('stat-result-shape', () => {
  it('passes well-formed stat trace', async () => {
    const v = createStatResultShapeVerifier();
    const trace = makeTrace({
      intel_kind: 'stat',
      statistic: 2.5,
      p_value: 0.04,
      n_observations: 100,
      test_name: 't-test',
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBe(1);
  });

  it('partial-fails when one field bad', async () => {
    const v = createStatResultShapeVerifier();
    const trace = makeTrace({
      intel_kind: 'stat',
      statistic: 2.5,
      p_value: 5, // out of range
      n_observations: 100,
      test_name: 't-test',
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('partial');
  });
});

describe('graph-query-non-empty', () => {
  it('passes when non-empty + shape matches', async () => {
    const v = createGraphQueryNonEmptyVerifier();
    const trace = makeTrace({
      intel_kind: 'graph_db',
      result_count: 5,
      shape_matches: true,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
  });

  it('fails when expected non-empty but empty', async () => {
    const v = createGraphQueryNonEmptyVerifier();
    const trace = makeTrace({
      intel_kind: 'graph_db',
      result_count: 0,
      expected_non_empty: true,
      shape_matches: false,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('fail');
  });
});

describe('causal-refutation-stable', () => {
  it('passes when ≥ 2 of 3 refutations within tolerance', async () => {
    const v = createCausalRefutationStableVerifier();
    const trace = makeTrace({
      intel_kind: 'causal',
      estimate: 1.0,
      refutation_estimates: [1.01, 0.99, 2.0],
      tolerance: 0.1,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
  });

  it('fails when refutations diverge wildly', async () => {
    const v = createCausalRefutationStableVerifier();
    const trace = makeTrace({
      intel_kind: 'causal',
      estimate: 1.0,
      refutation_estimates: [5.0, 6.0, 7.0],
      tolerance: 0.1,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('fail');
  });
});

describe('anomaly-precision-recall', () => {
  it('passes when F1 ≥ floor', async () => {
    const v = createAnomalyPrecisionRecallVerifier();
    const trace = makeTrace({
      intel_kind: 'anomaly',
      true_positives: 8,
      false_positives: 2,
      false_negatives: 2,
      f1_floor: 0.7,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBeGreaterThan(0.7);
  });
});

describe('recommendation-hit-rate', () => {
  it('passes when hit rate ≥ 0.5', async () => {
    const v = createRecommendationHitRateVerifier();
    const trace = makeTrace({
      intel_kind: 'recommendation',
      top_k_clicked: 3,
      k: 5,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
  });

  it('fails when no click', async () => {
    const v = createRecommendationHitRateVerifier();
    const trace = makeTrace({
      intel_kind: 'recommendation',
      top_k_clicked: 0,
      k: 5,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('fail');
  });
});

describe('createIntelBuiltinVerifiers', () => {
  it('returns all six verifiers', () => {
    const all = createIntelBuiltinVerifiers();
    const names = all.map((v) => v.name).sort();
    expect(names).toEqual(
      [
        'anomaly-precision-recall',
        'causal-refutation-stable',
        'forecast-interval-coverage',
        'graph-query-non-empty',
        'recommendation-hit-rate',
        'stat-result-shape',
      ].sort(),
    );
  });
});
