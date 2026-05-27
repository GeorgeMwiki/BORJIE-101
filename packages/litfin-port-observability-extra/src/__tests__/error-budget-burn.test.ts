import { describe, expect, it } from 'vitest';
import {
  SRE_30D_THRESHOLDS,
  burnRate,
  burnVerdict,
  errorRatio,
  remainingBudget,
  type SloDefinition,
} from '../error-budget-burn.js';

const slo: SloDefinition = { slobId: 'http_5xx', targetRatio: 0.999, windowDays: 30 };

describe('error-budget-burn', () => {
  it('errorRatio handles zero total', () => {
    expect(errorRatio({ totalRequests: 0, badRequests: 0 })).toBe(0);
  });

  it('errorRatio computes correctly', () => {
    expect(errorRatio({ totalRequests: 100, badRequests: 5 })).toBe(0.05);
  });

  it('burnRate of zero errors is 0', () => {
    expect(burnRate({ totalRequests: 1000, badRequests: 0 }, slo)).toBe(0);
  });

  it('burnRate matches budget when error rate = (1 - target)', () => {
    // targetRatio 0.999 -> allowed 0.001
    expect(burnRate({ totalRequests: 1000, badRequests: 1 }, slo)).toBeCloseTo(1, 5);
  });

  it('burnRate spikes when error rate > allowed', () => {
    // 0.1 / 0.001 = 100 (within IEEE-754 precision; matches the
    // toBeCloseTo style used for the burn=1 case above).
    expect(burnRate({ totalRequests: 100, badRequests: 10 }, slo)).toBeCloseTo(100, 5);
  });

  it('burnRate handles 100% SLO as infinite', () => {
    const perfect: SloDefinition = { slobId: 'p', targetRatio: 1, windowDays: 30 };
    expect(burnRate({ totalRequests: 100, badRequests: 1 }, perfect)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('burnVerdict pages on dual fast burn', () => {
    expect(burnVerdict(20, 20)).toBe('page');
  });

  it('burnVerdict tickets on slower dual burn', () => {
    expect(burnVerdict(8, 8)).toBe('ticket');
  });

  it('burnVerdict ok when within budget', () => {
    expect(burnVerdict(1, 1)).toBe('ok');
  });

  it('burnVerdict requires both windows for page', () => {
    expect(burnVerdict(100, 1)).toBe('ok');
  });

  it('remainingBudget reports correct count', () => {
    const out = remainingBudget({ totalRequests: 10_000, badRequests: 5 }, slo);
    // allowed = floor(10000 * 0.001) = 10. Remaining = 10 - 5 = 5.
    expect(out).toBe(5);
  });

  it('remainingBudget clamped at 0', () => {
    expect(
      remainingBudget({ totalRequests: 10_000, badRequests: 9999 }, slo),
    ).toBe(0);
  });

  it('SRE_30D_THRESHOLDS exposes documented values', () => {
    expect(SRE_30D_THRESHOLDS.pageThreshold).toBe(14.4);
    expect(SRE_30D_THRESHOLDS.ticketThreshold).toBe(6);
  });
});
