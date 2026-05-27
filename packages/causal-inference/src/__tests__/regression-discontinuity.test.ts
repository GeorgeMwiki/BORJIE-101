import { describe, expect, it } from 'vitest';
import {
  regressionDiscontinuity,
  type RdObservation,
} from '../estimate/regression-discontinuity.js';
import { CausalInferenceError } from '../types.js';

describe('Sharp regression discontinuity', () => {
  it('recovers a known jump of 5 at threshold 0', () => {
    const obs: RdObservation[] = [];
    // Left side: y = 2 + 1*r, r in [-2, 0).
    for (let r = -2; r < 0; r += 0.1) {
      obs.push({ running: r, outcome: 2 + r });
    }
    // Right side: y = 7 + 1*r, r in [0, 2].
    for (let r = 0; r <= 2; r += 0.1) {
      obs.push({ running: r, outcome: 7 + r });
    }
    const tau = regressionDiscontinuity(obs, { threshold: 0, bandwidth: 2 });
    // Pure-TS local linear: jump at r=0 is from y=2 to y=7 -> tau=5.
    expect(tau.estimate).toBeCloseTo(5, 1);
    expect(tau.identification).toBe('rd');
  });

  it('returns CI bounds bracketing the estimate (noisy data)', () => {
    const obs: RdObservation[] = [];
    // Add small deterministic noise so residual variance is > 0 and
    // the CI half-width is strictly positive.
    let n = 0;
    for (let r = -1; r < 0; r += 0.05) {
      const noise = ((n % 7) - 3) * 0.01;
      obs.push({ running: r, outcome: r + noise });
      n += 1;
    }
    for (let r = 0; r <= 1; r += 0.05) {
      const noise = ((n % 5) - 2) * 0.01;
      obs.push({ running: r, outcome: 3 + r + noise });
      n += 1;
    }
    const tau = regressionDiscontinuity(obs, { threshold: 0, bandwidth: 1 });
    expect(tau.ciLow).toBeLessThan(tau.estimate);
    expect(tau.ciHigh).toBeGreaterThan(tau.estimate);
  });

  it('throws on insufficient data', () => {
    expect(() =>
      regressionDiscontinuity([
        { running: -1, outcome: 1 },
        { running: 1, outcome: 2 },
      ]),
    ).toThrow(CausalInferenceError);
  });

  it('uses default bandwidth when not supplied', () => {
    const obs: RdObservation[] = [];
    for (let r = -3; r < 0; r += 0.1) obs.push({ running: r, outcome: r });
    for (let r = 0; r <= 3; r += 0.1) obs.push({ running: r, outcome: 2 + r });
    const tau = regressionDiscontinuity(obs, { threshold: 0 });
    expect(Number.isFinite(tau.estimate)).toBe(true);
  });
});
