/**
 * Ensemble tests — weighted convex combination + conservative envelope.
 *
 * Pins:
 *  - point[s] = Σ w_i · point_i[s]
 *  - lower[s] = min over members, upper[s] = max over members
 *  - normalised weights enforced (sum-to-1 within 1e-6)
 *
 * Wave SOTA-FORECAST.
 */

import { describe, it, expect } from 'vitest';
import {
  combineForecasts,
  createEnsembleForecaster,
} from '../ensemble/ensemble.js';
import { createNaiveLastForecaster, createNaiveMeanForecaster } from '../models/naive-baseline.js';
import type { ForecastResult, TimeSeries } from '../types.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function dailySeries(values: ReadonlyArray<number>): TimeSeries {
  return {
    id: 'fix-ens',
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
  };
}

function fakeResult(point: ReadonlyArray<number>, lo: number, hi: number): ForecastResult {
  return {
    seriesId: 'x',
    model: 'naive-last',
    modelVersion: 't',
    horizon: { steps: point.length },
    point,
    intervals_80: point.map((_, i) => ({ step: i + 1, lower: lo, upper: hi })),
    intervals_95: point.map((_, i) => ({ step: i + 1, lower: lo - 2, upper: hi + 2 })),
    generatedAtISO: new Date().toISOString(),
  };
}

describe('combineForecasts', () => {
  it('computes weighted point + min/max envelope', () => {
    const a = fakeResult([10, 20], 8, 12);
    const b = fakeResult([20, 30], 16, 24);
    const out = combineForecasts({
      seriesId: 'x',
      horizon: { steps: 2 },
      weighted: [
        { result: a, weight: 0.5 },
        { result: b, weight: 0.5 },
      ],
    });
    expect(out.point).toEqual([15, 25]);
    // envelope: min lower, max upper
    expect(out.intervals_80[0]).toEqual({ step: 1, lower: 8, upper: 24 });
    expect(out.intervals_95[1]).toEqual({ step: 2, lower: 6, upper: 26 });
  });

  it('rejects when weights do not sum to 1', () => {
    const a = fakeResult([1, 2], 0, 3);
    expect(() =>
      combineForecasts({
        seriesId: 'x',
        horizon: { steps: 2 },
        weighted: [{ result: a, weight: 0.7 }],
      }),
    ).toThrow(/sum to 1/);
  });

  it('rejects when a member horizon does not match', () => {
    const a = fakeResult([1, 2], 0, 3);
    expect(() =>
      combineForecasts({
        seriesId: 'x',
        horizon: { steps: 3 },
        weighted: [{ result: a, weight: 1 }],
      }),
    ).toThrow(/point length 2/);
  });
});

describe('createEnsembleForecaster', () => {
  it('fans out to members and combines into ensemble result', async () => {
    const ens = createEnsembleForecaster({
      members: [
        { forecaster: createNaiveLastForecaster(), weight: 0.5 },
        { forecaster: createNaiveMeanForecaster(), weight: 0.5 },
      ],
    });
    const r = await ens.predict({
      series: dailySeries([2, 4, 6, 8]),
      horizon: { steps: 2 },
    });
    // naive-last → [8, 8]; naive-mean → [5, 5]; ensemble → [6.5, 6.5]
    expect(r.model).toBe('ensemble');
    expect(r.point[0]).toBeCloseTo(6.5, 9);
    expect(r.point[1]).toBeCloseTo(6.5, 9);
  });

  it('rejects an empty member list', () => {
    expect(() => createEnsembleForecaster({ members: [] })).toThrow(/no members/);
  });
});
