import { describe, expect, it } from 'vitest';
import {
  calibrateConfidence,
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
