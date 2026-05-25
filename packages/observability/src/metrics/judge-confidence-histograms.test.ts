/**
 * Tests for judge / confidence histogram registration (D6).
 *
 * Covers:
 *   - Histograms register without throwing
 *   - The registry is cached (idempotent re-registration)
 *   - `recordJudgeScore` + `recordConfidenceOverall` accept normal +
 *     out-of-range + NaN values without throwing (clamping path)
 *   - Bucket boundaries match the documented quality tiers
 *   - The test-only registry reset works
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  JUDGE_CONFIDENCE_BUCKETS,
  registerJudgeConfidenceHistograms,
  recordJudgeScore,
  recordConfidenceOverall,
  getJudgeConfidenceHistograms,
  __resetJudgeConfidenceHistogramRegistryForTests,
} from './judge-confidence-histograms.js';
import { initMetrics, shutdownMetrics } from './metrics.js';
import type { TelemetryConfig } from '../types/telemetry.types.js';

const testConfig: TelemetryConfig = {
  service: {
    name: 'test-judge-confidence',
    version: '0.0.0',
    environment: 'development',
  },
  enabled: true,
  logLevel: 'info',
  traceSampleRatio: 0.1,
  metricsIntervalMs: 60_000,
};

beforeEach(() => {
  initMetrics(testConfig);
});

afterEach(async () => {
  __resetJudgeConfidenceHistogramRegistryForTests();
  await shutdownMetrics();
});

describe('JUDGE_CONFIDENCE_BUCKETS', () => {
  it('exposes the documented quality-tier bucket layout', () => {
    expect(JUDGE_CONFIDENCE_BUCKETS).toEqual([0.1, 0.25, 0.5, 0.75, 0.9]);
  });

  it('is sorted ascending so Prometheus accepts the bucket layout', () => {
    const sorted = [...JUDGE_CONFIDENCE_BUCKETS].sort((a, b) => a - b);
    expect(JUDGE_CONFIDENCE_BUCKETS).toEqual(sorted);
  });
});

describe('registerJudgeConfidenceHistograms', () => {
  it('returns a registry with both histograms', () => {
    const reg = registerJudgeConfidenceHistograms();
    expect(reg.judgeScore).toBeDefined();
    expect(reg.confidenceOverall).toBeDefined();
    expect(typeof reg.judgeScore.record).toBe('function');
    expect(typeof reg.confidenceOverall.record).toBe('function');
  });

  it('is idempotent — re-registering returns the same handles', () => {
    const a = registerJudgeConfidenceHistograms();
    const b = registerJudgeConfidenceHistograms();
    expect(a).toBe(b);
    expect(a.judgeScore).toBe(b.judgeScore);
    expect(a.confidenceOverall).toBe(b.confidenceOverall);
  });
});

describe('recordJudgeScore', () => {
  it('records a normal in-range value without throwing', () => {
    expect(() => recordJudgeScore(0.7, { stakes: 'high' })).not.toThrow();
  });

  it('clamps a negative score to 0 without throwing', () => {
    expect(() => recordJudgeScore(-0.3)).not.toThrow();
  });

  it('clamps a > 1 score to 1 without throwing', () => {
    expect(() => recordJudgeScore(1.7)).not.toThrow();
  });

  it('coerces NaN to 0 without throwing', () => {
    expect(() => recordJudgeScore(Number.NaN)).not.toThrow();
  });

  it('accepts an empty label set', () => {
    expect(() => recordJudgeScore(0.5)).not.toThrow();
  });
});

describe('recordConfidenceOverall', () => {
  it('records a normal in-range value without throwing', () => {
    expect(() =>
      recordConfidenceOverall(0.8, { stakes: 'medium' }),
    ).not.toThrow();
  });

  it('clamps out-of-range values without throwing', () => {
    expect(() => recordConfidenceOverall(2)).not.toThrow();
    expect(() => recordConfidenceOverall(-1)).not.toThrow();
  });
});

describe('getJudgeConfidenceHistograms', () => {
  it('returns the lazily-registered histograms', () => {
    const h = getJudgeConfidenceHistograms();
    expect(h.judgeScore).toBeDefined();
    expect(h.confidenceOverall).toBeDefined();
  });
});
