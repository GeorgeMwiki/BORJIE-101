/**
 * estate-baseline-computer.test.ts — locks the statistical core of Wave-D
 * estate-baseline schema formation: the min-sample honest-degrade guard, the
 * Bessel-corrected (n-1) sd, the non-finite filter, the fact-key contract, and
 * the null/empty-db guards. A baseline must NEVER be fabricated from too-little
 * data (a wrong "normal" would mis-tune a live drive).
 */

import { describe, it, expect } from 'vitest';

import {
  meanSdN,
  baselineFactKey,
  computeEstateBaselines,
  MIN_BASELINE_SAMPLES,
  type EstateBaseline,
} from '../estate-baseline-computer';

describe('meanSdN — min-sample guard + Bessel sd', () => {
  it('returns null below minSamples (no baseline from too-little data)', () => {
    expect(meanSdN([1, 2, 3, 4], 5)).toBeNull();
    expect(meanSdN([], MIN_BASELINE_SAMPLES)).toBeNull();
  });

  it('computes mean + Bessel-corrected (n-1) sd at/above minSamples', () => {
    // 2,4,4,4,5,5,7,9 → mean 5; Σ(x-μ)² = 32; sample variance 32/7; sd ≈ 2.138.
    const r = meanSdN([2, 4, 4, 4, 5, 5, 7, 9], 5);
    expect(r).not.toBeNull();
    expect(r?.n).toBe(8);
    expect(r?.mean).toBeCloseTo(5, 10);
    expect(r?.sd).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });

  it('filters non-finite observations before counting toward the sample', () => {
    const r = meanSdN([1, 2, Number.NaN, 3, 4, 5, Infinity], 5);
    expect(r?.n).toBe(5); // NaN + Infinity dropped
    expect(r?.mean).toBeCloseTo(3, 10);
  });

  it('honest-degrades a single-sample request to sd=0 (only reachable at minSamples=1)', () => {
    const r = meanSdN([42], 1);
    expect(r).toEqual({ mean: 42, sd: 0, n: 1 });
  });
});

describe('baselineFactKey — writer/reader contract', () => {
  it('builds the exact baseline:<scope>:<metric> key the resolver reads', () => {
    const b: EstateBaseline = {
      scope: 'estate',
      metric: 'cash_runway_d',
      mean: 30,
      sd: 5,
      n: 12,
    };
    expect(baselineFactKey(b)).toBe('baseline:estate:cash_runway_d');
  });
});

describe('computeEstateBaselines — guards', () => {
  it('returns an empty (frozen) array for a null db', async () => {
    const out = await computeEstateBaselines(null, 't1');
    expect(out).toEqual([]);
    expect(Object.isFrozen(out)).toBe(true);
  });

  it('returns empty for an empty tenantId', async () => {
    const db = { execute: async () => [] };
    expect(await computeEstateBaselines(db, '')).toEqual([]);
  });

  it('emits NO baseline when every metric has too-little history', async () => {
    // Every sampler reads from this stub → 2 rows < MIN_BASELINE_SAMPLES → no
    // baseline for any metric (honest-degrade, never fabricated).
    const db = {
      execute: async () => [{ day_value: 30 }, { day_value: 31 }],
    };
    expect(await computeEstateBaselines(db, 't1')).toEqual([]);
  });
});
