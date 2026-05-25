/**
 * Sub-MD SLO + slo-monitor tests.
 */

import { describe, it, expect } from 'vitest';
import {
  parseSubMdSlo,
  computeDelta,
  isLowerBetterMetric,
} from '../slo/sub-md-slo.js';
import { evaluateSlo } from '../slo/slo-monitor.js';
import type { SloEvent, SubMdSlo } from '../types.js';

const TENANT = '11111111-1111-1111-1111-111111111111';

describe('parseSubMdSlo', () => {
  it('produces a frozen SLO with shadow as default canary stage', () => {
    const slo = parseSubMdSlo({
      subMd: 'arrears-triage',
      tenantId: null,
      metric: 'resolution-quality',
      target: 0.85,
      window: 'rolling-24h',
      breachAction: 'reduce-traffic',
    });
    expect(slo.canaryStage).toBe('shadow');
    expect(Object.isFrozen(slo)).toBe(true);
  });

  it('refuses unknown metrics', () => {
    expect(() =>
      parseSubMdSlo({
        subMd: 'x',
        tenantId: null,
        metric: 'made-up' as never,
        target: 1,
        window: 'rolling-24h',
        breachAction: 'warn',
      }),
    ).toThrow();
  });
});

describe('computeDelta', () => {
  it('higher-is-better: actual - target', () => {
    expect(computeDelta('resolution-quality', 0.9, 0.85)).toBeCloseTo(0.05);
    expect(computeDelta('resolution-quality', 0.8, 0.85)).toBeCloseTo(-0.05);
  });

  it('lower-is-better: target - actual', () => {
    expect(computeDelta('cost-per-resolution', 100, 200)).toBeCloseTo(100);
    expect(computeDelta('cost-per-resolution', 300, 200)).toBeCloseTo(-100);
  });

  it('isLowerBetterMetric classifies correctly', () => {
    expect(isLowerBetterMetric('cost-per-resolution')).toBe(true);
    expect(isLowerBetterMetric('resolution-quality')).toBe(false);
  });
});

describe('evaluateSlo', () => {
  const baseSlo: SubMdSlo = Object.freeze({
    subMd: 'arrears-triage',
    tenantId: TENANT,
    metric: 'resolution-quality',
    target: 0.85,
    window: 'rolling-24h',
    breachAction: 'reduce-traffic',
    canaryStage: 'canary-25pct',
  });

  function mkEvent(delta: number, i: number): SloEvent {
    return Object.freeze({
      subMd: 'arrears-triage',
      tenantId: TENANT,
      timestamp: new Date(Date.now() - i * 1000).toISOString(),
      metric: 'resolution-quality',
      actualValue: 0.85 + delta,
      delta,
    });
  }

  it('returns no-op when sample is below minSampleSize', () => {
    const events = Array.from({ length: 5 }, (_, i) => mkEvent(-0.5, i));
    const verdict = evaluateSlo(baseSlo, events);
    expect(verdict.breached).toBe(false);
    expect(verdict.action).toBe('no-op');
  });

  it('returns no-op when mean delta is non-negative', () => {
    const events = Array.from({ length: 12 }, (_, i) => mkEvent(0.05, i));
    const verdict = evaluateSlo(baseSlo, events);
    expect(verdict.breached).toBe(false);
  });

  it('warns when breach is within tolerance band', () => {
    // tolerance band default = 5% of |target| = 0.0425; -0.02 is inside.
    const events = Array.from({ length: 12 }, (_, i) => mkEvent(-0.02, i));
    const verdict = evaluateSlo(baseSlo, events);
    expect(verdict.breached).toBe(true);
    expect(verdict.action).toBe('warn');
  });

  it('demotes one stage on reduce-traffic action when out of tolerance', () => {
    const events = Array.from({ length: 12 }, (_, i) => mkEvent(-0.2, i));
    const verdict = evaluateSlo(baseSlo, events);
    expect(verdict.breached).toBe(true);
    expect(verdict.action).toBe('reduce-traffic');
    expect(verdict.nextStage).toBe('canary-5pct');
  });

  it('returns warn when reduce-traffic hits the shadow floor', () => {
    const sloAtFloor: SubMdSlo = Object.freeze({
      ...baseSlo,
      canaryStage: 'shadow',
    });
    const events = Array.from({ length: 12 }, (_, i) => mkEvent(-0.5, i));
    const verdict = evaluateSlo(sloAtFloor, events);
    expect(verdict.breached).toBe(true);
    expect(verdict.action).toBe('warn');
  });

  it('returns handoff when breachAction is handoff', () => {
    const sloHandoff: SubMdSlo = Object.freeze({
      ...baseSlo,
      breachAction: 'handoff',
    });
    const events = Array.from({ length: 12 }, (_, i) => mkEvent(-0.3, i));
    const verdict = evaluateSlo(sloHandoff, events);
    expect(verdict.action).toBe('handoff');
    expect(verdict.nextStage).toBe('shadow');
  });

  it('returns kill-and-rollback when breachAction is kill-and-rollback', () => {
    const sloKill: SubMdSlo = Object.freeze({
      ...baseSlo,
      breachAction: 'kill-and-rollback',
    });
    const events = Array.from({ length: 12 }, (_, i) => mkEvent(-0.5, i));
    const verdict = evaluateSlo(sloKill, events);
    expect(verdict.action).toBe('kill-and-rollback');
  });

  it('filters events not matching the SLO subMd/metric', () => {
    const sloRollupRate: SubMdSlo = Object.freeze({
      ...baseSlo,
      metric: 'task-completion-rate',
      target: 0.9,
    });
    const mismatched: SloEvent = Object.freeze({
      subMd: 'other',
      tenantId: TENANT,
      timestamp: new Date().toISOString(),
      metric: 'resolution-quality',
      actualValue: 0.1,
      delta: -0.5,
    });
    const verdict = evaluateSlo(sloRollupRate, [mismatched]);
    expect(verdict.action).toBe('no-op');
    expect(verdict.reason).toMatch(/sample size/);
  });
});
