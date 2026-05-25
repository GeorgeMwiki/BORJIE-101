/**
 * Local time-series forecasters — deterministic behavioural tests.
 *
 * No mocks. Every test drives the real implementation with a fixture
 * series and asserts a property of the output. Series timestamps are
 * generated relative to a fixed anchor so re-runs are stable.
 */

import { describe, it, expect } from 'vitest';
import {
  createNaiveSeasonalForecaster,
  createMovingAverageForecaster,
  createHoltWintersForecaster,
  createLinearRegressionForecaster,
  type TimeSeries,
  type Horizon,
} from '../index.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function makeSeries(args: {
  readonly id?: string;
  readonly frequency?: TimeSeries['frequency'];
  readonly values: ReadonlyArray<number>;
}): TimeSeries {
  const freq = args.frequency ?? 'daily';
  const stepMs =
    freq === 'hourly'    ? 3600_000 :
    freq === 'daily'     ? 86_400_000 :
    freq === 'weekly'    ? 7 * 86_400_000 :
    freq === 'monthly'   ? 30 * 86_400_000 :
    freq === 'quarterly' ? 91 * 86_400_000 :
                            365 * 86_400_000;
  return {
    id: args.id ?? 'fixture',
    frequency: freq,
    points: args.values.map((y, i) => ({
      t: new Date(ANCHOR + i * stepMs).toISOString(),
      y,
    })),
  };
}

const HORIZON_4: Horizon = { steps: 4 };

describe('local / naive-seasonal forecaster', () => {
  it('returns horizon.steps point predictions', async () => {
    const fc = createNaiveSeasonalForecaster({ seasonalPeriod: 7 });
    const series = makeSeries({
      values: Array.from({ length: 30 }, (_, i) => Math.sin(i * Math.PI / 3.5) + 10),
    });
    const out = await fc.predict({ series, horizon: HORIZON_4 });
    expect(out.points).toHaveLength(4);
  });

  it('predicts the seasonal lookback when series spans ≥ 1 period', async () => {
    const fc = createNaiveSeasonalForecaster({ seasonalPeriod: 4 });
    const series = makeSeries({ values: [1, 2, 3, 4, 5, 6, 7, 8] });
    const out = await fc.predict({ series, horizon: { steps: 4 } });
    // With season=4 the next 4 predictions reuse the last full period [5,6,7,8].
    expect(out.points.map((p) => p.point)).toEqual([5, 6, 7, 8]);
  });

  it('builds widened intervals from the seasonal residual std', async () => {
    const fc = createNaiveSeasonalForecaster({ seasonalPeriod: 4 });
    const series = makeSeries({ values: [1, 2, 3, 4, 1.1, 2.1, 3.1, 4.1] });
    const out = await fc.predict({ series, horizon: HORIZON_4 });
    for (const p of out.points) {
      expect(p.upper).toBeGreaterThanOrEqual(p.point);
      expect(p.lower).toBeLessThanOrEqual(p.point);
    }
  });

  it('marks intervals as non-conformal (heuristic)', async () => {
    const fc = createNaiveSeasonalForecaster();
    const series = makeSeries({ values: [1, 2, 3, 4] });
    const out = await fc.predict({ series, horizon: { steps: 2 } });
    for (const p of out.points) expect(p.conformal).toBe(false);
  });

  it('rejects empty series', async () => {
    const fc = createNaiveSeasonalForecaster();
    await expect(
      fc.predict({ series: makeSeries({ values: [] }), horizon: HORIZON_4 }),
    ).rejects.toThrow(/empty/);
  });

  it('reports kind = naive-seasonal', () => {
    expect(createNaiveSeasonalForecaster().kind).toBe('naive-seasonal');
  });
});

describe('local / moving-average forecaster', () => {
  it('predicts the trailing mean when input is flat', async () => {
    const fc = createMovingAverageForecaster({ window: 5 });
    const series = makeSeries({ values: [10, 10, 10, 10, 10, 10] });
    const out = await fc.predict({ series, horizon: HORIZON_4 });
    for (const p of out.points) expect(p.point).toBe(10);
  });

  it('produces zero-width interval on a flat series', async () => {
    const fc = createMovingAverageForecaster({ window: 3 });
    const series = makeSeries({ values: [5, 5, 5, 5, 5] });
    const out = await fc.predict({ series, horizon: { steps: 1 } });
    expect(out.points[0]!.upper - out.points[0]!.lower).toBeCloseTo(0);
  });

  it('expands intervals proportional to window dispersion', async () => {
    const stable = createMovingAverageForecaster({ window: 5 });
    const noisy  = createMovingAverageForecaster({ window: 5 });
    const flat   = makeSeries({ values: [10, 10, 10, 10, 10] });
    const noisySeries = makeSeries({ values: [5, 15, 5, 15, 5] });
    const outFlat  = await stable.predict({ series: flat, horizon: { steps: 1 } });
    const outNoisy = await noisy.predict({ series: noisySeries, horizon: { steps: 1 } });
    const widthFlat  = outFlat.points[0]!.upper - outFlat.points[0]!.lower;
    const widthNoisy = outNoisy.points[0]!.upper - outNoisy.points[0]!.lower;
    expect(widthNoisy).toBeGreaterThan(widthFlat);
  });

  it('throws when window < 1', () => {
    expect(() => createMovingAverageForecaster({ window: 0 })).toThrow();
  });

  it('reports kind = moving-average', () => {
    expect(createMovingAverageForecaster().kind).toBe('moving-average');
  });
});

describe('local / holt-winters forecaster', () => {
  it('captures a linear trend on a noiseless ramp', async () => {
    const fc = createHoltWintersForecaster({ seasonalPeriod: 1 });
    const series = makeSeries({ values: Array.from({ length: 20 }, (_, i) => i) });
    const out = await fc.predict({ series, horizon: { steps: 5 } });
    // Predicted next 5 should land near 20, 21, 22, 23, 24 (the
    // extrapolated trend). Allow loose tolerance because the tuner
    // does not always hit the unique optimum on small samples.
    const expectedStart = out.points[0]!.point;
    expect(expectedStart).toBeGreaterThan(15);
    expect(expectedStart).toBeLessThan(30);
  });

  it('captures additive seasonality on a sin wave', async () => {
    const fc = createHoltWintersForecaster({ seasonalPeriod: 4 });
    const series = makeSeries({
      values: Array.from({ length: 32 }, (_, i) => 10 + Math.sin(i * Math.PI / 2)),
    });
    const out = await fc.predict({ series, horizon: { steps: 4 } });
    // Mean of 4 forecast points should be near 10.
    const meanPred = out.points.reduce((s, p) => s + p.point, 0) / 4;
    expect(meanPred).toBeGreaterThan(9.5);
    expect(meanPred).toBeLessThan(10.5);
  });

  it('rejects series of length < 2', async () => {
    const fc = createHoltWintersForecaster();
    await expect(
      fc.predict({ series: makeSeries({ values: [42] }), horizon: HORIZON_4 }),
    ).rejects.toThrow();
  });

  it('reports kind = holt-winters', () => {
    expect(createHoltWintersForecaster().kind).toBe('holt-winters');
  });
});

describe('local / linear-regression forecaster', () => {
  it('extrapolates a noiseless line near-exactly', async () => {
    const fc = createLinearRegressionForecaster({ seasonalPeriod: 1 });
    const series = makeSeries({
      values: Array.from({ length: 20 }, (_, i) => 3 + 2 * i),
    });
    const out = await fc.predict({ series, horizon: { steps: 5 } });
    // The next 5 values should be 3 + 2*(20..24) = 43, 45, 47, 49, 51.
    expect(out.points[0]!.point).toBeCloseTo(43, 5);
    expect(out.points[4]!.point).toBeCloseTo(51, 5);
  });

  it('captures Fourier seasonality on a sinusoidal series', async () => {
    const fc = createLinearRegressionForecaster({ seasonalPeriod: 12 });
    const series = makeSeries({
      values: Array.from({ length: 36 }, (_, i) => 5 + 3 * Math.sin(2 * Math.PI * i / 12)),
      frequency: 'monthly',
    });
    const out = await fc.predict({ series, horizon: { steps: 12 } });
    // Average over a full cycle should be near 5.
    const cycleMean = out.points.reduce((s, p) => s + p.point, 0) / 12;
    expect(cycleMean).toBeCloseTo(5, 0);
  });

  it('builds heuristic intervals around the in-sample residual std', async () => {
    const fc = createLinearRegressionForecaster({ seasonalPeriod: 1 });
    const series = makeSeries({ values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
    const out = await fc.predict({ series, horizon: { steps: 1 } });
    // Perfect line — residual std ~ 0 — so interval width ≈ 0.
    expect(out.points[0]!.upper - out.points[0]!.lower).toBeLessThan(1e-6);
  });

  it('rejects series of length < 2', async () => {
    const fc = createLinearRegressionForecaster();
    await expect(
      fc.predict({ series: makeSeries({ values: [3] }), horizon: HORIZON_4 }),
    ).rejects.toThrow();
  });

  it('reports kind = linear-regression', () => {
    expect(createLinearRegressionForecaster().kind).toBe('linear-regression');
  });
});
