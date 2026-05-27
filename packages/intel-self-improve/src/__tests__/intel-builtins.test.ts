/**
 * Tests for the six RLVR built-in verifiers added by the
 * intel-self-improve wave.
 */

import { describe, expect, it } from 'vitest';
import type { RlvrTrace } from '@borjie/post-training-rlvr';
import {
  createAnomalyPrecisionRecallVerifier,
  createCausalRefutationStableVerifier,
  createForecastIntervalCoverageVerifier,
  createGraphQueryNonEmptyVerifier,
  createRecommendationHitRateVerifier,
  createStatResultShapeVerifier,
} from '../verifiers/intel-builtins.js';

function buildTrace(
  metadata: Readonly<Record<string, unknown>>,
): RlvrTrace {
  return Object.freeze({
    id: 'trace-1',
    runId: 'run-1',
    tenantId: 'tenant-acme',
    prompt: '',
    completion: '',
    toolCalls: [],
    metadata,
    capturedAt: '2026-05-27T08:00:00.000Z',
  });
}

describe('forecast-interval-coverage verifier', () => {
  const v = createForecastIntervalCoverageVerifier();

  it('passes when observed value lies inside both intervals', async () => {
    const trace = buildTrace({
      intel_kind: 'forecast',
      observed_value: 1850,
      interval_80: { lower: 1800, upper: 1900 },
      interval_95: { lower: 1750, upper: 1950 },
    });
    expect(v.applies(trace)).toBe(true);
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBe(1);
  });

  it('returns partial when observed value misses 80% but inside 95%', async () => {
    const trace = buildTrace({
      intel_kind: 'forecast',
      observed_value: 1925,
      interval_80: { lower: 1800, upper: 1900 },
      interval_95: { lower: 1750, upper: 1950 },
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('partial');
    expect(result.reward).toBe(0.5);
  });

  it('skips when ground-truth fields are missing', async () => {
    const trace = buildTrace({ intel_kind: 'forecast' });
    expect(v.applies(trace)).toBe(false);
    const result = await v.verify(trace);
    expect(result.verdict).toBe('skip');
  });
});

describe('stat-result-shape verifier', () => {
  const v = createStatResultShapeVerifier();

  it('passes for a well-formed t-test result', async () => {
    const trace = buildTrace({
      intel_kind: 'stat',
      statistic: 2.13,
      p_value: 0.04,
      n_observations: 120,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBe(1);
  });

  it('fails when p-value is out of [0, 1]', async () => {
    const trace = buildTrace({
      intel_kind: 'stat',
      statistic: 2.13,
      p_value: 1.5,
      n_observations: 120,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('fail');
  });
});

describe('graph-query-non-empty verifier', () => {
  const v = createGraphQueryNonEmptyVerifier();

  it('passes when result is non-empty and schema matches', async () => {
    const trace = buildTrace({
      intel_kind: 'graph_db',
      result_count: 3,
      expected_cardinality: 'non_empty',
      schema_match: true,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
  });

  it('passes empty result when cardinality is allow_empty', async () => {
    const trace = buildTrace({
      intel_kind: 'graph_db',
      result_count: 0,
      expected_cardinality: 'allow_empty',
      schema_match: true,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
  });

  it('fails empty result when cardinality is non_empty', async () => {
    const trace = buildTrace({
      intel_kind: 'graph_db',
      result_count: 0,
      expected_cardinality: 'non_empty',
      schema_match: true,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('fail');
  });
});

describe('causal-refutation-stable verifier', () => {
  const v = createCausalRefutationStableVerifier();

  it('passes when >=2 of 3 refutations stay within tolerance', async () => {
    const trace = buildTrace({
      intel_kind: 'causal',
      point_estimate: 100,
      refutation_estimates: [102, 98, 130],
      tolerance_ratio: 0.1,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
  });

  it('returns partial when only one refutation is stable', async () => {
    const trace = buildTrace({
      intel_kind: 'causal',
      point_estimate: 100,
      refutation_estimates: [101, 150, 180],
      tolerance_ratio: 0.1,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('partial');
  });
});

describe('anomaly-precision-recall verifier', () => {
  const v = createAnomalyPrecisionRecallVerifier();

  it('passes when F1 >= 0.7', async () => {
    const trace = buildTrace({
      intel_kind: 'anomaly',
      true_positives: 8,
      false_positives: 2,
      false_negatives: 2,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBeCloseTo(0.8, 5);
  });

  it('returns fail for zero precision and recall', async () => {
    const trace = buildTrace({
      intel_kind: 'anomaly',
      true_positives: 0,
      false_positives: 10,
      false_negatives: 10,
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('fail');
    expect(result.reward).toBe(0);
  });
});

describe('recommendation-hit-rate verifier', () => {
  const v = createRecommendationHitRateVerifier();

  it('passes when at least one top-K item is clicked', async () => {
    const trace = buildTrace({
      intel_kind: 'recommendation',
      top_k: ['buyer-a', 'buyer-b', 'buyer-c'],
      clicked_item_ids: ['buyer-b'],
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('pass');
    expect(result.reward).toBe(1);
  });

  it('fails when no top-K item is clicked', async () => {
    const trace = buildTrace({
      intel_kind: 'recommendation',
      top_k: ['buyer-a', 'buyer-b', 'buyer-c'],
      clicked_item_ids: ['buyer-z'],
    });
    const result = await v.verify(trace);
    expect(result.verdict).toBe('fail');
    expect(result.reward).toBe(0);
  });
});
