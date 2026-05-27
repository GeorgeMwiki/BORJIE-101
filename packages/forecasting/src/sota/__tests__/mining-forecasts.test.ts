/**
 * Mining-domain forecast wrapper tests.
 *
 * These tests verify Mr. Mwikila's six narrow APIs against pure-TS
 * naive baselines (no foundation-model deps) so the test path is
 * fully hermetic and deterministic.
 *
 * Wave SOTA-FORECAST.
 */

import { describe, it, expect } from 'vitest';
import {
  forecastGoldPrice,
  forecastProductionVolume,
  forecastDemand,
  forecastWorkforce,
  forecastFuelCost,
  forecastRoyaltyRevenue,
} from '../domain/mining-forecasts.js';
import type { ForecastResult, TimeSeries } from '../types.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function dailySeries(
  id: string,
  values: ReadonlyArray<number>,
  unit?: string,
): TimeSeries {
  return {
    id,
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
    ...(unit !== undefined ? { unit } : {}),
  };
}

function weeklySeries(id: string, values: ReadonlyArray<number>): TimeSeries {
  return {
    id,
    frequency: 'weekly',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 7 * 86_400_000).toISOString(),
      y,
    })),
  };
}

function flatResult(steps: number, value: number): ForecastResult {
  return {
    seriesId: 'comp',
    model: 'naive-last',
    modelVersion: 'test',
    horizon: { steps },
    point: Array.from({ length: steps }, () => value),
    intervals_80: Array.from({ length: steps }, (_, i) => ({
      step: i + 1,
      lower: value * 0.95,
      upper: value * 1.05,
    })),
    intervals_95: Array.from({ length: steps }, (_, i) => ({
      step: i + 1,
      lower: value * 0.9,
      upper: value * 1.1,
    })),
    generatedAtISO: new Date().toISOString(),
  };
}

describe('forecastGoldPrice', () => {
  it('returns a forecast and narrative with USD/oz unit', async () => {
    const r = await forecastGoldPrice({
      series: dailySeries(
        'lme-gold',
        // 21 daily prints, drifting upward
        Array.from({ length: 21 }, (_, i) => 2000 + i * 5),
        'USD/oz',
      ),
      horizon: { steps: 5 },
    });
    expect(r.target).toBe('gold_price');
    expect(r.forecast.point).toHaveLength(5);
    expect(r.narrative.detail).toMatch(/Mr\. Mwikila/);
    expect(r.narrative.detail).toMatch(/USD\/oz/);
  });
});

describe('forecastProductionVolume', () => {
  it('tags the pit id in the sources array', async () => {
    const r = await forecastProductionVolume({
      pitId: 'pit-MARA-04',
      series: dailySeries(
        'pit-04-tonnes',
        Array.from({ length: 21 }, (_, i) => 100 + (i % 7) * 3),
      ),
      horizon: { steps: 7 },
    });
    expect(r.target).toBe('production_volume');
    expect(r.sources).toContain('pit:pit-MARA-04');
    expect(r.forecast.point).toHaveLength(7);
  });
});

describe('forecastDemand', () => {
  it('produces a weekly off-take forecast', async () => {
    const r = await forecastDemand({
      series: weeklySeries(
        'offtake-A',
        Array.from({ length: 20 }, (_, i) => 50 + i * 2),
      ),
      horizon: { steps: 4 },
    });
    expect(r.target).toBe('demand');
    expect(r.sources).toContain('off-take-partner-feed');
    expect(r.forecast.point).toHaveLength(4);
  });
});

describe('forecastWorkforce', () => {
  it('produces a workforce headcount forecast tagged HRIS', async () => {
    const r = await forecastWorkforce({
      series: weeklySeries(
        'workforce',
        Array.from({ length: 16 }, (_, i) => 120 + (i % 4) * 5),
      ),
      horizon: { steps: 4 },
    });
    expect(r.target).toBe('workforce');
    expect(r.sources).toContain('hris');
  });
});

describe('forecastFuelCost', () => {
  it('uses TZS/L as the unit and naive-last + arima/chronos slot', async () => {
    const r = await forecastFuelCost({
      series: dailySeries(
        'fuel-daily',
        Array.from({ length: 14 }, (_, i) => 3200 + i * 10),
      ),
      horizon: { steps: 3 },
    });
    expect(r.target).toBe('fuel');
    expect(r.narrative.detail).toMatch(/TZS\/L/);
  });
});

describe('forecastRoyaltyRevenue', () => {
  it('composes price × volume × (royalty + clearing) bps', () => {
    const price = flatResult(3, 2000); // 2000 USD/oz
    const volume = flatResult(3, 50); // 50 oz/day
    const r = forecastRoyaltyRevenue({
      priceForecast: price,
      volumeForecast: volume,
      royaltyRateBps: 600, // 6 %
      clearingFeeBps: 100, // 1 %
      tenantId: 'tenant-x',
    });
    expect(r.target).toBe('royalty');
    // Expected median ≈ 2000 × 50 × 0.07 = 7000 (MC noise small).
    for (const p of r.forecast.point) {
      expect(p).toBeGreaterThan(6000);
      expect(p).toBeLessThan(8000);
    }
    expect(r.forecast.meta?.['mcSeed']).toBe(4221);
  });

  it('rejects horizon mismatch between price and volume', () => {
    expect(() =>
      forecastRoyaltyRevenue({
        priceForecast: flatResult(3, 2000),
        volumeForecast: flatResult(2, 50),
        royaltyRateBps: 600,
        clearingFeeBps: 100,
        tenantId: 'tenant-x',
      }),
    ).toThrow(/horizons must match/);
  });

  it('rejects out-of-range bps values', () => {
    const price = flatResult(2, 2000);
    const volume = flatResult(2, 50);
    expect(() =>
      forecastRoyaltyRevenue({
        priceForecast: price,
        volumeForecast: volume,
        royaltyRateBps: 20_000,
        clearingFeeBps: 100,
        tenantId: 'tenant-x',
      }),
    ).toThrow(/royaltyRateBps/);
    expect(() =>
      forecastRoyaltyRevenue({
        priceForecast: price,
        volumeForecast: volume,
        royaltyRateBps: 600,
        clearingFeeBps: -1,
        tenantId: 'tenant-x',
      }),
    ).toThrow(/clearingFeeBps/);
  });
});
