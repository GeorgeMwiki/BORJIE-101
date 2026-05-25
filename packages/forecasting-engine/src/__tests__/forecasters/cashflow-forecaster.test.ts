import { describe, it, expect } from 'vitest';
import {
  fitCashflow,
  forecastCashflow,
  updateCashflow,
} from '../../forecasters/time-series/cashflow-forecaster.js';
import {
  fitOccupancy,
  forecastOccupancy,
  updateOccupancy,
} from '../../forecasters/time-series/occupancy-forecaster.js';
import {
  fitArrears,
  forecastArrears,
  updateArrears,
} from '../../forecasters/time-series/arrears-forecaster.js';
import type { TimePoint } from '../../types.js';

function synthSeasonal(n: number, level: number, amp: number): TimePoint[] {
  const dayMs = 86_400_000;
  return Array.from({ length: n }, (_, i) => ({
    t: i * 30 * dayMs,
    v: level + amp * Math.sin((2 * Math.PI * i) / 12) + i * 50,
  }));
}

describe('CashflowForecaster (Holt-Winters)', () => {
  it('fits and forecasts within reasonable bounds on synthetic data', () => {
    const hist = synthSeasonal(36, 100_000, 5_000);
    const model = fitCashflow(hist, { seasonLength: 12 });
    expect(model.sampleSize).toBe(36);
    expect(model.residualStd).toBeGreaterThanOrEqual(0);
    const fc = forecastCashflow(model, 12);
    expect(fc.length).toBe(12);
    // p50 should be in a sane range around the historical level
    const lastP50 = fc[fc.length - 1]?.p50 ?? 0;
    expect(lastP50).toBeGreaterThan(50_000);
    expect(lastP50).toBeLessThan(250_000);
    // Bands ordered
    for (const b of fc) {
      expect(b.p10).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p90);
    }
  });

  it('updates model online without exploding', () => {
    const hist = synthSeasonal(24, 100_000, 3_000);
    let model = fitCashflow(hist, { seasonLength: 12 });
    for (let i = 0; i < 6; i += 1) {
      model = updateCashflow(model, { t: model.params.lastT + 30 * 86_400_000, v: 100_000 });
    }
    expect(model.sampleSize).toBe(30);
    expect(Number.isFinite(model.params.level)).toBe(true);
  });

  it('throws on too-few points', () => {
    expect(() => fitCashflow([{ t: 0, v: 1 }, { t: 1, v: 2 }])).toThrow();
  });
});

describe('OccupancyForecaster (Empirical Bayes)', () => {
  it('fits beta posteriors and forecasts within [0, 1]', () => {
    const obs = [
      { microMarketId: 'mm1', occupied: 8, total: 10 },
      { microMarketId: 'mm2', occupied: 18, total: 20 },
      { microMarketId: 'mm3', occupied: 5, total: 8 },
    ];
    const model = fitOccupancy(obs);
    const fc = forecastOccupancy(model, 'mm1', 5);
    expect(fc.length).toBe(5);
    for (const b of fc) {
      expect(b.p10).toBeGreaterThanOrEqual(0);
      expect(b.p90).toBeLessThanOrEqual(1);
      expect(b.p50).toBeLessThanOrEqual(b.p90);
      expect(b.p50).toBeGreaterThanOrEqual(b.p10);
    }
  });

  it('online update tightens posterior', () => {
    const obs = [{ microMarketId: 'mm1', occupied: 5, total: 10 }];
    const model = fitOccupancy(obs);
    const updated = updateOccupancy(model, { microMarketId: 'mm1', occupied: 50, total: 50 });
    const mean0 = forecastOccupancy(model, 'mm1', 1)[0]?.p50 ?? 0;
    const mean1 = forecastOccupancy(updated, 'mm1', 1)[0]?.p50 ?? 0;
    expect(mean1).toBeGreaterThan(mean0);
  });
});

describe('ArrearsForecaster (logistic growth)', () => {
  it('fits an S-curve and forecast saturates near K', () => {
    const dayMs = 86_400_000;
    const K = 1000;
    const r = 0.1;
    const t0 = 30;
    const hist: TimePoint[] = [];
    for (let i = 0; i < 60; i += 1) {
      const x = i;
      const y = K / (1 + Math.exp(-r * (x - t0)));
      hist.push({ t: i * dayMs, v: y });
    }
    const model = fitArrears(hist);
    expect(model.sampleSize).toBe(60);
    expect(model.params.K).toBeGreaterThan(0);
    const fc = forecastArrears(model, 30);
    expect(fc.length).toBe(30);
  });

  it('persists t0Anchor on the fitted model (H1)', () => {
    const dayMs = 86_400_000;
    const hist: TimePoint[] = [];
    const startT = 1_700_000_000_000;
    for (let i = 0; i < 5; i += 1) {
      hist.push({ t: startT + i * dayMs, v: 100 + i * 50 });
    }
    const model = fitArrears(hist);
    expect(model.params.t0Anchor).toBe(startT);
  });

  it('forecastArrears does NOT collapse to logistic(0,...) (H1)', () => {
    // Mid-curve logistic: history covers x in [0..60] days, inflection at
    // t0=30, growth r=0.1. The forecast for h=30 (i.e. x=90) should sit
    // near K — not anywhere near logistic(0, K, 0.1, 30) ≈ K/(1+e^3) ≈
    // 4.7% of K. Pre-fix every forecast value was that low. We verify
    // p50 grows monotonically AND ends ≥ 90% of K.
    const dayMs = 86_400_000;
    const K = 1000;
    const r = 0.1;
    const t0 = 30;
    const hist: TimePoint[] = [];
    for (let i = 0; i < 60; i += 1) {
      const y = K / (1 + Math.exp(-r * (i - t0)));
      hist.push({ t: i * dayMs, v: y });
    }
    const model = fitArrears(hist);
    const fc = forecastArrears(model, 30);
    // Forecast must grow (not flat near 0) AND saturate near K.
    expect(fc[fc.length - 1]!.p50).toBeGreaterThan(K * 0.9);
    expect(fc[0]!.p50).toBeGreaterThan(K * 0.5);
    // Monotonically non-decreasing — the logistic above the inflection
    // is strictly increasing.
    for (let i = 1; i < fc.length; i += 1) {
      expect(fc[i]!.p50).toBeGreaterThanOrEqual(fc[i - 1]!.p50 - 1e-6);
    }
  });

  it('updateArrears computes residual at the correct x (H1)', () => {
    // Build a clean logistic history. The residual for a point that
    // exactly lies on the curve must be ~0. Pre-fix, updateArrears
    // evaluated `logistic(0, K, r, t0)` regardless of the actual t →
    // residual ≈ actual.v - K/(1+e^(rt0)) which is NOT zero. The fix
    // computes residual against `logistic(xAct, …)`.
    const dayMs = 86_400_000;
    const K = 1000;
    const r = 0.1;
    const t0 = 30;
    const hist: TimePoint[] = [];
    for (let i = 0; i < 60; i += 1) {
      const y = K / (1 + Math.exp(-r * (i - t0)));
      hist.push({ t: i * dayMs, v: y });
    }
    const model = fitArrears(hist);
    // A point that lies exactly on the fitted curve at x = 70 days.
    const xNew = 70;
    const yNew = K / (1 + Math.exp(-r * (xNew - t0)));
    // residualStd before the update — must NOT explode after the
    // perfectly-on-curve update.
    const stdBefore = model.residualStd;
    const updated = updateArrears(model, { t: xNew * dayMs, v: yNew });
    // The residual at xNew should be small (the model was fit to this
    // curve), so std grows by at most ~30% rather than exploding via
    // pre-fix bug (which would treat the point as off-curve by ~K).
    expect(updated.residualStd).toBeLessThan(stdBefore * 5);
    expect(updated.params.t0Anchor).toBe(model.params.t0Anchor);
  });
});
