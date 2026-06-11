/**
 * calibrated-confidence — the conformal calibration adapter.
 *
 * Calibration MUST precede gating: a confident-but-uncalibrated model is
 * shrunk toward the coverage its recent track record has earned, never
 * inflated above it.
 */

import { describe, it, expect } from 'vitest';
import {
  calibratedConfidenceFromConformal,
  calibratedCoverageCeiling,
  type ConformalCoverageView,
} from '../calibrated-confidence.js';
import { decideAutonomy } from '../decide-autonomy.js';

describe('calibratedCoverageCeiling', () => {
  it('uses 1 - alpha when no observed coverage is supplied', () => {
    const view: ConformalCoverageView = { alpha: 0.1, targetCoverage: 0.9 };
    expect(calibratedCoverageCeiling(view)).toBeCloseTo(0.9, 10);
  });

  it('takes the min of (1 - alpha) and observed coverage when window drifted', () => {
    const view: ConformalCoverageView = {
      alpha: 0.05, // 1 - alpha = 0.95
      targetCoverage: 0.95,
      observedCoverage: 0.7, // window underperforming
    };
    expect(calibratedCoverageCeiling(view)).toBeCloseTo(0.7, 10);
  });

  it('clamps a degenerate alpha to [0,1]', () => {
    expect(
      calibratedCoverageCeiling({ alpha: -1, targetCoverage: 0.9 }),
    ).toBe(1);
    expect(
      calibratedCoverageCeiling({ alpha: 2, targetCoverage: 0.9 }),
    ).toBe(0);
  });
});

describe('calibratedConfidenceFromConformal', () => {
  it('shrinks an overconfident model down to the calibrated ceiling', () => {
    const view: ConformalCoverageView = { alpha: 0.2, targetCoverage: 0.8 };
    // Raw 0.99 overstates; calibrated coverage ceiling is 0.8.
    expect(calibratedConfidenceFromConformal(0.99, view)).toBeCloseTo(0.8, 10);
  });

  it('never inflates a low raw confidence above its own value', () => {
    const view: ConformalCoverageView = { alpha: 0.01, targetCoverage: 0.99 };
    // Ceiling is 0.99 but the model only claimed 0.4 — keep 0.4.
    expect(calibratedConfidenceFromConformal(0.4, view)).toBeCloseTo(0.4, 10);
  });

  it('discounts against the realised window coverage', () => {
    const view: ConformalCoverageView = {
      alpha: 0.05,
      targetCoverage: 0.95,
      observedCoverage: 0.6,
    };
    expect(calibratedConfidenceFromConformal(0.95, view)).toBeCloseTo(0.6, 10);
  });

  it('clamps a non-finite raw confidence to 0 (fail-cautious)', () => {
    const view: ConformalCoverageView = { alpha: 0.1, targetCoverage: 0.9 };
    expect(calibratedConfidenceFromConformal(Number.NaN, view)).toBe(0);
  });

  it('feeds straight into decideAutonomy: poor calibration forces a gate', () => {
    const view: ConformalCoverageView = {
      alpha: 0.4, // calibrated coverage ceiling 0.6
      targetCoverage: 0.9,
    };
    const calibrated = calibratedConfidenceFromConformal(0.99, view);
    expect(calibrated).toBeCloseTo(0.6, 10);

    // 0.6 is below the moderate floor (0.85) → gate, attributed to confidence.
    const out = decideAutonomy({
      calibratedConfidence: calibrated,
      consequenceTier: 'moderate',
      reversibility: 'reversible',
      mandate: 'operator',
    });
    expect(out.decision).toBe('gate');
    expect(out.gatedBy).toBe('confidence');
  });

  it('well-calibrated high confidence keeps a high-consequence reversible act auto', () => {
    const view: ConformalCoverageView = {
      alpha: 0.02, // ceiling 0.98
      targetCoverage: 0.95,
      observedCoverage: 0.97,
    };
    const calibrated = calibratedConfidenceFromConformal(0.99, view);
    // min(0.99, min(0.98, 0.97)) = 0.97 — clears the high floor (0.95).
    expect(calibrated).toBeCloseTo(0.97, 10);

    const out = decideAutonomy({
      calibratedConfidence: calibrated,
      consequenceTier: 'high',
      reversibility: 'reversible',
      mandate: 'operator',
    });
    expect(out.decision).toBe('auto');
  });
});
