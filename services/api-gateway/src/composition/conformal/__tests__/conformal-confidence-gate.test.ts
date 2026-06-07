/**
 * Conformal confidence gate tests — the LOAD-BEARING proof that the calibrated
 * alpha actually changes the confidence the live chat path emits.
 *
 * Covers:
 *   1. alpha === baseline (0.1) ⇒ thresholds unshifted ⇒ stable tier snap.
 *   2. alpha undefined ⇒ conformal-off ⇒ identical to baseline.
 *   3. alpha ABOVE baseline ⇒ thresholds RELAX ⇒ the SAME float clears a HIGHER
 *      tier (the loop demonstrably raised the emitted confidence).
 *   4. alpha BELOW baseline ⇒ thresholds TIGHTEN ⇒ the SAME float drops a tier
 *      (the loop demonstrably lowered the emitted confidence).
 *   5. shift is capped (a wild alpha cannot collapse the tiers).
 *   6. high ≥ medium ≥ low invariant holds after clamping/re-ordering.
 *   7. NaN / out-of-range alpha is handled (treated as off / clamped).
 *   8. constants mirror the proven cognitive-engine confidence-calibrator.
 */

import { describe, it, expect } from 'vitest';
import {
  applyConformalConfidence,
  conformalAdjustedTiers,
  classifyConfidenceTier,
  DEFAULT_CONFIDENCE_TIERS,
  CONFORMAL_BASELINE_ALPHA,
  CONFORMAL_THRESHOLD_GAIN,
  CONFORMAL_MAX_THRESHOLD_SHIFT,
} from '../conformal-confidence-gate.js';

describe('conformal confidence gate', () => {
  it('mirrors the proven cognitive-engine constants', () => {
    // These MUST stay in lockstep with @borjie/cognitive-engine
    // confidence-calibrator (CONFORMAL_BASELINE_ALPHA / GAIN / MAX_SHIFT,
    // DEFAULT_THRESHOLDS) so a tier means the same thing live as in the
    // 13/13 unit-tested package.
    expect(CONFORMAL_BASELINE_ALPHA).toBe(0.1);
    expect(CONFORMAL_THRESHOLD_GAIN).toBe(1.0);
    expect(CONFORMAL_MAX_THRESHOLD_SHIFT).toBe(0.15);
    expect(DEFAULT_CONFIDENCE_TIERS).toEqual({
      high: 0.75,
      medium: 0.5,
      low: 0.3,
    });
  });

  it('alpha === baseline leaves thresholds unshifted', () => {
    const t = conformalAdjustedTiers(DEFAULT_CONFIDENCE_TIERS, 0.1);
    expect(t).toEqual(DEFAULT_CONFIDENCE_TIERS);
  });

  it('alpha undefined ⇒ conformal-off, identical to baseline snap', () => {
    const off = applyConformalConfidence(0.62, undefined);
    const atBaseline = applyConformalConfidence(0.62, 0.1);
    expect(off.tier).toBe('medium');
    expect(off.confidence).toBe(atBaseline.confidence);
    expect(off.calibratedAlpha).toBeUndefined();
  });

  it('alpha ABOVE baseline RELAXES tiers — same float clears a HIGHER tier', () => {
    // 0.62 is "medium" at baseline (>=0.5, <0.75).
    const baseline = applyConformalConfidence(0.62, 0.1);
    expect(baseline.tier).toBe('medium');

    // alpha = 0.25 ⇒ shift = clamp(1.0*(0.25-0.1), ±0.15) = +0.15 ⇒
    // high threshold 0.75-0.15 = 0.60. Now 0.62 >= 0.60 ⇒ HIGH.
    const relaxed = applyConformalConfidence(0.62, 0.25);
    expect(relaxed.effectiveThresholds.high).toBeCloseTo(0.6, 5);
    expect(relaxed.tier).toBe('high');
    // The emitted confidence is STRICTLY higher than the baseline emit — the
    // loop changed the live output.
    expect(relaxed.confidence).toBeGreaterThan(baseline.confidence);
    expect(relaxed.calibratedAlpha).toBe(0.25);
  });

  it('alpha BELOW baseline TIGHTENS tiers — same float drops a tier', () => {
    // 0.55 is "medium" at baseline.
    const baseline = applyConformalConfidence(0.55, 0.1);
    expect(baseline.tier).toBe('medium');

    // alpha = 0.0 ⇒ shift = clamp(1.0*(0-0.1), ±0.15) = -0.10 ⇒
    // medium threshold 0.5-(-0.1) = 0.60. Now 0.55 < 0.60 ⇒ drops to LOW.
    const tightened = applyConformalConfidence(0.55, 0.0);
    expect(tightened.effectiveThresholds.medium).toBeCloseTo(0.6, 5);
    expect(tightened.tier).toBe('low');
    // The emitted confidence is STRICTLY lower than baseline — loop lowered it.
    expect(tightened.confidence).toBeLessThan(baseline.confidence);
  });

  it('caps the shift so a wild alpha cannot collapse the tiers', () => {
    // alpha = 1 ⇒ raw shift +0.9, capped to +0.15.
    const t = conformalAdjustedTiers(DEFAULT_CONFIDENCE_TIERS, 1);
    expect(t.high).toBeCloseTo(0.6, 5); // 0.75 - 0.15
    expect(t.medium).toBeCloseTo(0.35, 5); // 0.5 - 0.15
    expect(t.low).toBeCloseTo(0.15, 5); // 0.3 - 0.15
  });

  it('keeps high ≥ medium ≥ low after clamping', () => {
    for (const alpha of [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.9, 1]) {
      const t = conformalAdjustedTiers(DEFAULT_CONFIDENCE_TIERS, alpha);
      expect(t.high).toBeGreaterThanOrEqual(t.medium);
      expect(t.medium).toBeGreaterThanOrEqual(t.low);
      expect(t.high).toBeLessThanOrEqual(1);
      expect(t.low).toBeGreaterThanOrEqual(0);
    }
  });

  it('NaN alpha is treated as conformal-off', () => {
    const r = applyConformalConfidence(0.8, Number.NaN);
    expect(r.effectiveThresholds).toEqual(DEFAULT_CONFIDENCE_TIERS);
    expect(r.tier).toBe('high');
  });

  it('clamps the raw confidence into [0,1] before classifying', () => {
    expect(applyConformalConfidence(1.5, 0.1).tier).toBe('high');
    expect(applyConformalConfidence(-0.2, 0.1).tier).toBe('floor');
  });

  it('floor tier never reads as low (label and number agree)', () => {
    const r = applyConformalConfidence(0.1, 0.1); // below low=0.3
    expect(r.tier).toBe('floor');
    expect(r.confidence).toBeLessThan(DEFAULT_CONFIDENCE_TIERS.low);
  });

  it('classifyConfidenceTier respects shifted thresholds directly', () => {
    const shifted = conformalAdjustedTiers(DEFAULT_CONFIDENCE_TIERS, 0.25);
    expect(classifyConfidenceTier(0.6, shifted)).toBe('high');
    expect(classifyConfidenceTier(0.59, shifted)).toBe('medium');
  });
});
