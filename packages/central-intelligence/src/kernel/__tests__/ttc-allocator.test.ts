/**
 * TTC allocator — unit tests.
 *
 * Verifies:
 *   - low stakes → fast
 *   - medium stakes + low ambiguity → fast
 *   - medium stakes + high ambiguity → deliberate
 *   - high stakes → judge
 *   - critical stakes → multi-sample
 *   - critical + high ambiguity → 5 samples
 *   - requireJudge upgrades a fast mode to judge
 *   - tiny cost ceiling downgrades multi-sample → judge → deliberate → fast
 *   - marketing surface caps multi-sample → judge
 *   - classroom surface caps multi-sample → judge
 *   - token cap tracks stakes
 *   - budget tracks stakes & ceiling
 */

import { describe, it, expect } from 'vitest';
import { allocateTtc, TTC_DEFAULTS } from '../ttc-allocator.js';

describe('TTC allocator — base modes by stakes', () => {
  it('low → fast', () => {
    const r = allocateTtc({ stakes: 'low', surface: 'tenant-app' });
    expect(r.cognitionMode).toBe('fast');
    expect(r.samples).toBe(1);
  });

  it('medium + low ambiguity → fast', () => {
    const r = allocateTtc({
      stakes: 'medium',
      surface: 'tenant-app',
      ambiguityScore: 0.1,
    });
    expect(r.cognitionMode).toBe('fast');
  });

  it('medium + high ambiguity → deliberate', () => {
    const r = allocateTtc({
      stakes: 'medium',
      surface: 'tenant-app',
      ambiguityScore: 0.6,
    });
    expect(r.cognitionMode).toBe('deliberate');
  });

  it('high → judge', () => {
    const r = allocateTtc({ stakes: 'high', surface: 'owner-portal' });
    expect(r.cognitionMode).toBe('judge');
  });

  it('critical → multi-sample, 3 samples by default', () => {
    const r = allocateTtc({ stakes: 'critical', surface: 'owner-portal' });
    expect(r.cognitionMode).toBe('multi-sample');
    expect(r.samples).toBe(3);
  });

  it('critical + high ambiguity → 5 samples', () => {
    const r = allocateTtc({
      stakes: 'critical',
      surface: 'owner-portal',
      ambiguityScore: 0.9,
    });
    expect(r.samples).toBe(5);
  });
});

describe('TTC allocator — caller overrides', () => {
  it('requireJudge upgrades fast to judge', () => {
    const r = allocateTtc({
      stakes: 'low',
      surface: 'tenant-app',
      requireJudge: true,
    });
    expect(r.cognitionMode).toBe('judge');
  });

  it('requireJudge does not downgrade multi-sample', () => {
    const r = allocateTtc({
      stakes: 'critical',
      surface: 'owner-portal',
      requireJudge: true,
    });
    expect(r.cognitionMode).toBe('multi-sample');
  });
});

describe('TTC allocator — cost ceiling downgrades', () => {
  it('tiny ceiling downgrades multi-sample to judge', () => {
    const r = allocateTtc({
      stakes: 'critical',
      surface: 'owner-portal',
      costCeilingUsd: 0.1,
    });
    expect(r.cognitionMode).toBe('judge');
  });

  it('very tiny ceiling downgrades to deliberate', () => {
    const r = allocateTtc({
      stakes: 'high',
      surface: 'owner-portal',
      costCeilingUsd: 0.02,
    });
    expect(r.cognitionMode).toBe('deliberate');
  });

  it('near-zero ceiling collapses to fast', () => {
    const r = allocateTtc({
      stakes: 'medium',
      surface: 'tenant-app',
      ambiguityScore: 0.8,
      costCeilingUsd: 0.005,
    });
    expect(r.cognitionMode).toBe('fast');
  });
});

describe('TTC allocator — surface caps', () => {
  it('marketing surface caps multi-sample to judge', () => {
    const r = allocateTtc({ stakes: 'critical', surface: 'marketing' });
    expect(r.cognitionMode).toBe('judge');
  });

  it('classroom surface caps multi-sample to judge', () => {
    const r = allocateTtc({ stakes: 'critical', surface: 'classroom' });
    expect(r.cognitionMode).toBe('judge');
  });
});

describe('TTC allocator — token & budget caps', () => {
  it('token cap tracks stakes', () => {
    const r = allocateTtc({ stakes: 'low', surface: 'tenant-app' });
    expect(r.maxTokens).toBe(TTC_DEFAULTS.tokenCapByStakes.low);
    const r2 = allocateTtc({ stakes: 'critical', surface: 'owner-portal' });
    expect(r2.maxTokens).toBe(TTC_DEFAULTS.tokenCapByStakes.critical);
  });

  it('budget is min(ceiling, stakes-budget)', () => {
    const r = allocateTtc({
      stakes: 'critical',
      surface: 'owner-portal',
      costCeilingUsd: 1.0,
    });
    expect(r.budgetUsd).toBe(TTC_DEFAULTS.budgetByStakes.critical);
    const r2 = allocateTtc({
      stakes: 'critical',
      surface: 'owner-portal',
      costCeilingUsd: 0.05,
    });
    expect(r2.budgetUsd).toBe(0.05);
  });
});
