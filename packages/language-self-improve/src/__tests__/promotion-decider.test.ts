import { describe, expect, it } from 'vitest';

import {
  checkSignificance,
  decidePromotion,
} from '../decide/promotion-decider.js';

describe('promotion-decider', () => {
  it('promotes when every axis improves past the ceiling', () => {
    const result = decidePromotion({
      wer: -0.02, // improvement (< -0.005)
      per: -0.01,
      grammar: 0.05,
      terminology: 0.05,
    });
    expect(result.decision).toBe('promote');
    expect(result.axesMeetingImprovement).toHaveLength(4);
    expect(result.axesTriggeringRollback).toHaveLength(0);
  });

  it('rolls back when ANY axis crosses the regression floor', () => {
    const result = decidePromotion({
      wer: 0.02, // regression (≥ 0.010)
      per: -0.01,
      grammar: 0.05,
      terminology: 0.05,
    });
    expect(result.decision).toBe('rollback');
    expect(result.axesTriggeringRollback).toContain('wer');
  });

  it('returns no-op when signal is mixed (some improve, none regress)', () => {
    const result = decidePromotion({
      wer: -0.02, // improvement
      per: -0.001, // below ceiling — neither improvement nor regression
      grammar: 0.005, // below ceiling
      terminology: 0.05, // improvement
    });
    expect(result.decision).toBe('no-op');
  });

  it('rolls back on grammar regression even with WER improvement', () => {
    const result = decidePromotion({
      wer: -0.05, // good
      per: -0.05,
      grammar: -0.05, // regression (≤ -0.030)
      terminology: 0.05,
    });
    expect(result.decision).toBe('rollback');
    expect(result.axesTriggeringRollback).toContain('grammar');
  });

  it('significance gate flags dialects below threshold', () => {
    const result = checkSignificance({
      bongo: 50,
      lake: 5, // below default min=30
      coast: 35,
      sheng: 32,
    });
    expect(result.significant).toBe(false);
    expect(result.insufficientDialects).toContain('lake');
  });

  it('significance gate passes when all dialects meet threshold', () => {
    const result = checkSignificance({
      bongo: 50,
      lake: 40,
      coast: 35,
      sheng: 32,
    });
    expect(result.significant).toBe(true);
    expect(result.insufficientDialects).toHaveLength(0);
  });
});
