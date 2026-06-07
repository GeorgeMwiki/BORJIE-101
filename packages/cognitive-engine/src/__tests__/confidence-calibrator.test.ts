import { describe, expect, it } from 'vitest';
import {
  calibrateConfidence,
  conformalAdjustedThresholds,
  CONFORMAL_BASELINE_ALPHA,
  CONFORMAL_MAX_THRESHOLD_SHIFT,
  DEFAULT_THRESHOLDS,
  reduceTier,
} from '../calibration/confidence-calibrator.js';

describe('calibrateConfidence', () => {
  it('returns high for strong inputs with no uncited claims', () => {
    const r = calibrateConfidence({
      mean_source_quality: 0.9,
      cross_source_agreement_rate: 0.9,
      corpus_consistency_rate: 0.9,
      days_since_evidence: 5,
      uncited_claims_after_rewrite: 0,
    });
    expect(r.label).toBe('high');
    expect(r.score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLDS.high);
  });

  it('returns medium for moderate inputs', () => {
    const r = calibrateConfidence({
      mean_source_quality: 0.55,
      cross_source_agreement_rate: 0.55,
      corpus_consistency_rate: 0.55,
      days_since_evidence: 30,
      uncited_claims_after_rewrite: 1,
    });
    expect(r.label).toBe('medium');
  });

  it('returns refused when score floor is missed', () => {
    const r = calibrateConfidence({
      mean_source_quality: 0.1,
      cross_source_agreement_rate: 0.1,
      corpus_consistency_rate: 0.1,
      days_since_evidence: 200,
      uncited_claims_after_rewrite: 5,
    });
    expect(r.label).toBe('refused');
  });

  it('demotes high to medium when uncited claims > 0', () => {
    const r = calibrateConfidence({
      mean_source_quality: 0.9,
      cross_source_agreement_rate: 0.9,
      corpus_consistency_rate: 0.9,
      days_since_evidence: 5,
      uncited_claims_after_rewrite: 1,
    });
    expect(r.label).toBe('medium');
  });

  it('recency curve hits zero at 90+ days', () => {
    const r = calibrateConfidence({
      mean_source_quality: 1,
      cross_source_agreement_rate: 1,
      corpus_consistency_rate: 1,
      days_since_evidence: 200,
      uncited_claims_after_rewrite: 0,
    });
    expect(r.components.recency).toBe(0);
  });
});

describe('conformal calibrated_alpha changes the confidence output', () => {
  // A borderline-medium input: score sits just below the default high
  // threshold (0.75) but comfortably above medium (0.5). Whether it clears
  // `high` depends entirely on where the conformal loop puts the threshold.
  // score = 0.9 * 0.66 + 0.1 * 1.0 = 0.694 — above medium (0.5), below high
  // (0.75). A +0.15 threshold relaxation (alpha 0.4) drops high to 0.60, which
  // 0.694 then clears.
  const borderline = {
    mean_source_quality: 0.66,
    cross_source_agreement_rate: 0.66,
    corpus_consistency_rate: 0.66,
    days_since_evidence: 0, // recency = 1
    uncited_claims_after_rewrite: 0,
  } as const;

  it('baseline alpha (no drift) leaves the label unchanged vs no-alpha', () => {
    const without = calibrateConfidence(borderline);
    const atBaseline = calibrateConfidence({
      ...borderline,
      calibrated_alpha: CONFORMAL_BASELINE_ALPHA,
    });
    expect(atBaseline.label).toBe(without.label);
    expect(atBaseline.effectiveThresholds.high).toBeCloseTo(
      DEFAULT_THRESHOLDS.high,
      10,
    );
  });

  it('HIGH alpha (over-covering) RELAXES thresholds → promotes the label', () => {
    const without = calibrateConfidence(borderline);
    const relaxed = calibrateConfidence({
      ...borderline,
      calibrated_alpha: 0.4, // well above baseline
    });
    // The base case must be sub-high for this test to be meaningful.
    expect(without.label).not.toBe('high');
    expect(relaxed.effectiveThresholds.high).toBeLessThan(
      DEFAULT_THRESHOLDS.high,
    );
    expect(relaxed.label).toBe('high');
    expect(relaxed.calibratedAlpha).toBe(0.4);
  });

  it('LOW alpha (under-covering) TIGHTENS thresholds → demotes the label', () => {
    const strong = {
      mean_source_quality: 0.78,
      cross_source_agreement_rate: 0.78,
      corpus_consistency_rate: 0.78,
      days_since_evidence: 0,
      uncited_claims_after_rewrite: 0,
    } as const;
    const without = calibrateConfidence(strong);
    expect(without.label).toBe('high'); // clears default 0.75
    const tightened = calibrateConfidence({
      ...strong,
      calibrated_alpha: 0.01, // well below baseline
    });
    expect(tightened.effectiveThresholds.high).toBeGreaterThan(
      DEFAULT_THRESHOLDS.high,
    );
    expect(tightened.label).not.toBe('high'); // threshold now above the score
  });

  it('clamps the shift and preserves high >= medium >= low ordering', () => {
    const t = conformalAdjustedThresholds(DEFAULT_THRESHOLDS, 0.5);
    expect(DEFAULT_THRESHOLDS.high - t.high).toBeLessThanOrEqual(
      CONFORMAL_MAX_THRESHOLD_SHIFT + 1e-9,
    );
    expect(t.high).toBeGreaterThanOrEqual(t.medium);
    expect(t.medium).toBeGreaterThanOrEqual(t.low);
    expect(t.low).toBeGreaterThanOrEqual(0);
  });

  it('undefined / NaN alpha returns the base thresholds untouched', () => {
    expect(conformalAdjustedThresholds(DEFAULT_THRESHOLDS, undefined)).toEqual(
      DEFAULT_THRESHOLDS,
    );
    expect(conformalAdjustedThresholds(DEFAULT_THRESHOLDS, NaN)).toEqual(
      DEFAULT_THRESHOLDS,
    );
  });
});

describe('reduceTier', () => {
  it('keeps the label when by=0', () => {
    expect(reduceTier('high', 0)).toBe('high');
  });
  it('drops one tier with by=1', () => {
    expect(reduceTier('high', 1)).toBe('medium');
    expect(reduceTier('medium', 1)).toBe('low');
    expect(reduceTier('low', 1)).toBe('refused');
  });
  it('drops two tiers with by=2', () => {
    expect(reduceTier('high', 2)).toBe('low');
    expect(reduceTier('medium', 2)).toBe('refused');
  });
});
