/**
 * Activation probe — unit tests.
 *
 * Verifies:
 *   - cold-start (baseline=null) returns neutral
 *   - small baseline (< 10 samples) returns neutral
 *   - sample within 1σ returns low score
 *   - sample > 2.5σ returns z>threshold reason
 *   - latency anomaly surfaces reason
 *   - tool-call anomaly surfaces reason
 *   - refusal anomaly contributes minimum 0.4 score
 */

import { describe, it, expect } from 'vitest';
import {
  createActivationProbe,
  ACTIVATION_PROBE_THRESHOLDS,
  type ActivationBaseline,
} from '../activation-probe.js';

const probe = createActivationProbe();

const baseline: ActivationBaseline = {
  meanLength: 500,
  stddevLength: 100,
  meanToolCalls: 1.5,
  meanLatencyMs: 800,
  stddevLatencyMs: 200,
  sampleSize: 100,
};

describe('activation probe', () => {
  it('cold start with no baseline is neutral', () => {
    const out = probe.observe({
      baseline: null,
      sample: {
        outputLength: 1000,
        toolCallCount: 5,
        latencyMs: 5000,
        refusalEmitted: true,
      },
    });
    expect(out.score).toBe(0);
    expect(out.reasons).toHaveLength(0);
  });

  it('small baseline is neutral', () => {
    const out = probe.observe({
      baseline: { ...baseline, sampleSize: 5 },
      sample: {
        outputLength: 1000,
        toolCallCount: 5,
        latencyMs: 5000,
        refusalEmitted: false,
      },
    });
    expect(out.score).toBe(0);
  });

  it('sample within 1σ scores low', () => {
    const out = probe.observe({
      baseline,
      sample: {
        outputLength: 550,
        toolCallCount: 2,
        latencyMs: 900,
        refusalEmitted: false,
      },
    });
    expect(out.score).toBeLessThan(0.3);
    expect(out.reasons).toHaveLength(0);
  });

  it('output-length z > threshold is surfaced', () => {
    const out = probe.observe({
      baseline,
      sample: {
        outputLength: 1200, // (1200-500)/100 = 7σ
        toolCallCount: 1,
        latencyMs: 800,
        refusalEmitted: false,
      },
    });
    expect(out.components.lengthZ).toBeGreaterThan(
      ACTIVATION_PROBE_THRESHOLDS.zScore,
    );
    expect(
      out.reasons.some((r) => r.includes('output-length-anomaly')),
    ).toBe(true);
  });

  it('latency anomaly surfaces', () => {
    const out = probe.observe({
      baseline,
      sample: {
        outputLength: 500,
        toolCallCount: 1,
        latencyMs: 5000, // (5000-800)/200 = 21σ
        refusalEmitted: false,
      },
    });
    expect(out.reasons.some((r) => r.includes('latency-anomaly'))).toBe(true);
  });

  it('tool-call delta surfaces', () => {
    const out = probe.observe({
      baseline,
      sample: {
        outputLength: 500,
        toolCallCount: 10, // delta = 8.5
        latencyMs: 800,
        refusalEmitted: false,
      },
    });
    expect(out.reasons.some((r) => r.includes('tool-call-anomaly'))).toBe(true);
  });

  it('refusal anomaly contributes >= 0.4 score', () => {
    const out = probe.observe({
      baseline,
      sample: {
        outputLength: 500,
        toolCallCount: 1,
        latencyMs: 800,
        refusalEmitted: true,
      },
    });
    expect(out.score).toBeGreaterThanOrEqual(0.4);
    expect(out.reasons.some((r) => r.includes('refusal-emitted'))).toBe(true);
  });
});
