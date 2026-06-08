/**
 * Portfolio router — selection + the floor-beating gate.
 *
 * Uses mock providers so the gate is testable deterministically:
 *  - a "perfect" candidate that returns the true continuation
 *    (low MASE — must be escalated above the floor), and
 *  - a "noisy" candidate that returns garbage (high MASE — must be
 *    REJECTED so the floor wins and baselineBeaten=false).
 */

import { describe, it, expect } from 'vitest';
import { createForecastRouter } from '../forecast-router.js';
import { createProviderRegistry } from '../../providers/registry.js';
import { createClassicalProvider } from '../../providers/classical-provider.js';
import type { ForecastProviderPort } from '../../providers/port.js';
import type {
  ForecastRequest,
  QuantileForecast,
  RawForecast,
  TimeSeries,
} from '../../types.js';

/** A provider that emits a fixed slope continuation (good on a linear trend). */
function linearProvider(name: string): ForecastProviderPort {
  return {
    name,
    kind: 'tsfm-selfhost',
    async health() {
      return { available: true, status: 'ok' };
    },
    async forecast(series, horizon, quantiles): Promise<RawForecast> {
      const n = series.values.length;
      const last = series.values[n - 1] ?? 0;
      const prev = series.values[n - 2] ?? last;
      const slope = last - prev;
      const steps: QuantileForecast[] = [];
      for (let h = 1; h <= horizon; h++) {
        const point = last + slope * h;
        const qmap: Record<string, number> = {};
        for (const q of quantiles) qmap[String(q)] = point;
        qmap['0.5'] = point;
        steps.push({ step: h, point, quantiles: qmap });
      }
      return { model: name, modelVersion: '1.0.0', steps, latencyMs: 1 };
    },
  };
}

/** A provider that returns a wildly wrong constant (must be rejected). */
function noisyProvider(name: string): ForecastProviderPort {
  return {
    name,
    kind: 'tsfm-api',
    async health() {
      return { available: true, status: 'ok' };
    },
    async forecast(_series, horizon, quantiles): Promise<RawForecast> {
      const steps: QuantileForecast[] = [];
      for (let h = 1; h <= horizon; h++) {
        const point = -99999; // absurd
        const qmap: Record<string, number> = {};
        for (const q of quantiles) qmap[String(q)] = point;
        qmap['0.5'] = point;
        steps.push({ step: h, point, quantiles: qmap });
      }
      return { model: name, modelVersion: '0.0.0', steps, latencyMs: 1 };
    },
  };
}

function linearSeries(n: number, slope = 2, start = 10): TimeSeries {
  return {
    seriesId: 'lin',
    values: Array.from({ length: n }, (_, i) => start + slope * i),
    seasonLength: 1,
  };
}

function req(series: TimeSeries, horizon: number): ForecastRequest {
  return {
    tenantId: 'tenant-1',
    target: 'mining.A1.commodity_price',
    series,
    horizon,
    quantiles: [0.05, 0.5, 0.95],
    targetCoverage: 0.9,
  };
}

describe('ForecastRouter — floor-beating gate', () => {
  it('ESCALATES a candidate that beats the floor on backtest', async () => {
    // On a clean linear trend the linear provider has ~0 MASE; the
    // ETS-Theta floor (slope/2 drift) is worse -> escalate.
    const registry = createProviderRegistry({
      floor: createClassicalProvider({ method: 'ets_theta' }),
      providers: [linearProvider('chronos-2')],
    });
    const router = createForecastRouter(registry, {
      candidateProvider: 'chronos-2',
    });
    const outcome = await router.route(req(linearSeries(60), 24));
    expect(outcome.escalated).toBe(true);
    expect(outcome.result.baselineBeaten).toBe(true);
    expect(outcome.result.model).toBe('chronos-2');
    // The floor is still cited as an input (append-never-replace).
    expect(outcome.result.evidenceIds.length).toBeGreaterThanOrEqual(2);
  });

  it('REJECTS a candidate that fails to beat the floor (keeps floor, flags false)', async () => {
    const registry = createProviderRegistry({
      floor: createClassicalProvider({ method: 'ets_theta' }),
      providers: [noisyProvider('bad-tsfm')],
    });
    const router = createForecastRouter(registry, {
      candidateProvider: 'bad-tsfm',
    });
    const outcome = await router.route(req(linearSeries(60), 24));
    expect(outcome.escalated).toBe(false);
    expect(outcome.result.baselineBeaten).toBe(false);
    // model is the floor's classical model
    expect(outcome.result.model).toContain('ets_theta');
  });

  it('never escalates for a short/floor-preferred regime even with a candidate', async () => {
    const registry = createProviderRegistry({
      providers: [linearProvider('chronos-2')],
    });
    const router = createForecastRouter(registry, {
      candidateProvider: 'chronos-2',
    });
    // short horizon + short series -> preferClassical, candidate not tried
    const outcome = await router.route(req(linearSeries(20), 3));
    expect(outcome.escalated).toBe(false);
    expect(outcome.candidateScore).toBeUndefined();
  });

  it('emits >=1 evidence id with full provenance and a calibrated interval', async () => {
    const registry = createProviderRegistry();
    const router = createForecastRouter(registry);
    const outcome = await router.route(req(linearSeries(50), 6));
    const r = outcome.result;
    expect(r.evidenceIds.length).toBeGreaterThanOrEqual(1);
    const ev = r.evidenceIds[0]!;
    expect(ev.model).toBeTruthy();
    expect(ev.version).toBeTruthy();
    expect(ev.inputWindow).toBe(50);
    expect(ev.horizon).toBe(6);
    expect(ev.coverage).toBeCloseTo(0.9, 6);
    expect(typeof ev.baselineBeaten).toBe('boolean');
    // intervals are present and finite for every step
    expect(r.intervals.length).toBe(6);
    for (const iv of r.intervals) {
      expect(iv.lower).toBeLessThanOrEqual(iv.upper);
    }
  });

  it('blends candidate + floor when blend=true and candidate wins', async () => {
    const registry = createProviderRegistry({
      floor: createClassicalProvider({ method: 'ets_theta' }),
      providers: [linearProvider('chronos-2')],
    });
    const router = createForecastRouter(registry, {
      candidateProvider: 'chronos-2',
      blend: true,
    });
    const outcome = await router.route(req(linearSeries(60), 24));
    expect(outcome.escalated).toBe(true);
    expect(outcome.result.model).toContain('blend');
  });

  it('is deterministic — same request yields the same forecastId + points', async () => {
    const registry = createProviderRegistry();
    const router = createForecastRouter(registry);
    const a = await router.route(req(linearSeries(40), 5));
    const b = await router.route(req(linearSeries(40), 5));
    expect(a.result.forecastId).toBe(b.result.forecastId);
    expect(a.result.points.map((p) => p.point)).toEqual(
      b.result.points.map((p) => p.point),
    );
  });
});
