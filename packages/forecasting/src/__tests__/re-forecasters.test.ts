/**
 * Real-estate composers — each composer wraps an ensemble over the
 * generic forecasters and adds domain-specific bounds + a textual
 * recommendation. Tests assert the bounds and the model-kind label.
 */

import { describe, it, expect } from 'vitest';
import {
  forecastRent,
  forecastOccupancy,
  forecastChurn,
  forecastMaintenanceFailure,
  forecastEnergyConsumption,
  forecastMarketCycle,
  rentCapFor,
  applyRentCap,
  type TimeSeries,
} from '../index.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function makeSeries(args: {
  readonly values: ReadonlyArray<number>;
  readonly frequency?: TimeSeries['frequency'];
  readonly id?: string;
  readonly unit?: string;
  readonly jurisdiction?: string;
}): TimeSeries {
  const freq = args.frequency ?? 'monthly';
  const stepMs =
    freq === 'monthly'   ? 30 * 86_400_000 :
    freq === 'weekly'    ? 7 * 86_400_000 :
    freq === 'daily'     ? 86_400_000 :
    freq === 'quarterly' ? 91 * 86_400_000 :
    freq === 'yearly'    ? 365 * 86_400_000 :
                            3600_000;
  const series: TimeSeries = {
    id: args.id ?? 'fixture',
    frequency: freq,
    points: args.values.map((y, i) => ({
      t: new Date(ANCHOR + i * stepMs).toISOString(),
      y,
    })),
    ...(args.unit !== undefined ? { unit: args.unit } : {}),
    ...(args.jurisdiction !== undefined ? { jurisdiction: args.jurisdiction } : {}),
  };
  return series;
}

describe('re-forecasters / rent', () => {
  it('returns a forecast with model kind re-rent', async () => {
    const fc = await forecastRent({
      unit: { id: 'u1', jurisdiction: 'TZ' },
      history: makeSeries({ values: [1000, 1010, 1020, 1030, 1050, 1070, 1080, 1090] }),
      horizon: { steps: 3 },
    });
    expect(fc.modelKind).toBe('re-rent');
    expect(fc.points).toHaveLength(3);
  });

  it('caps forecast growth at the TZ jurisdictional ceiling', async () => {
    // Use a long, very steep ramp so the ensemble's median forecast
    // certainly exceeds the cap (10% YoY off 1900).
    const fc = await forecastRent({
      unit: { id: 'u-cap', jurisdiction: 'TZ' },
      history: makeSeries({ values: [
        100, 300, 500, 700, 900, 1100, 1300, 1500, 1700, 1900,
      ] }),
      horizon: { steps: 1 },
    });
    // Every forecast point must respect the cap of priorPeriod * 1.10.
    // priorPeriod for step 1 is 1900; max = 2090.
    expect(fc.points[0]!.point).toBeLessThanOrEqual(2090 + 1e-6);
  });

  it('reports capped=true when comparables shrink the forecast above the cap', async () => {
    // With a baseline near 100, a giant comparable (10000) shrinks the
    // forecast far above the 10% cap, guaranteeing cap-trigger.
    const fc = await forecastRent({
      unit: { id: 'u-cap-on', jurisdiction: 'TZ' },
      history: makeSeries({ values: [100, 100, 100, 100, 100, 100, 100, 100] }),
      comparables: [makeSeries({ values: [10000, 10000, 10000, 10000] })],
      horizon: { steps: 2 },
    });
    expect(fc.meta?.['capped']).toBe(true);
    // Step 1 prior = 100, cap = 110.
    expect(fc.points[0]!.point).toBeLessThanOrEqual(110 + 1e-6);
  });

  it('does not cap when jurisdiction is US (permissive)', async () => {
    const fc = await forecastRent({
      unit: { id: 'u-us', jurisdiction: 'US' },
      history: makeSeries({ values: [
        100, 200, 400, 600, 800, 1000, 1500, 2000,
      ] }),
      horizon: { steps: 1 },
    });
    // Permissive but not unlimited; check we have a valid forecast.
    expect(Number.isFinite(fc.points[0]!.point)).toBe(true);
  });

  it('uses comparables when supplied to shrink the point estimate', async () => {
    const histA = await forecastRent({
      unit: { id: 'u-noComp', jurisdiction: 'KE' },
      history: makeSeries({ values: [500, 510, 520, 530, 540, 550, 560, 570] }),
      horizon: { steps: 2 },
    });
    const histB = await forecastRent({
      unit: { id: 'u-withComp', jurisdiction: 'KE' },
      history: makeSeries({ values: [500, 510, 520, 530, 540, 550, 560, 570] }),
      comparables: [makeSeries({ values: [1000, 1010, 1020, 1030] })],
      horizon: { steps: 2 },
    });
    // Comparable mean is 1015, which should pull the forecast up
    // relative to the no-comparable case (subject to the cap).
    expect(histB.points[0]!.point).toBeGreaterThan(histA.points[0]!.point);
  });

  it('rejects insufficient history', async () => {
    await expect(forecastRent({
      unit: { id: 'u-short', jurisdiction: 'TZ' },
      history: makeSeries({ values: [100, 200] }),
      horizon: { steps: 1 },
    })).rejects.toThrow();
  });
});

describe('re-forecasters / occupancy', () => {
  it('clamps every forecast point into [0,1]', async () => {
    const fc = await forecastOccupancy({
      property: { id: 'p1' },
      history: makeSeries({
        frequency: 'monthly',
        values: [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 0.95],
      }),
      horizon: { steps: 4 },
    });
    for (const p of fc.points) {
      expect(p.point).toBeGreaterThanOrEqual(0);
      expect(p.point).toBeLessThanOrEqual(1);
      expect(p.lower).toBeGreaterThanOrEqual(0);
      expect(p.upper).toBeLessThanOrEqual(1);
    }
    expect(fc.modelKind).toBe('re-occupancy');
  });

  it('recommends marketing review when occupancy projects below 0.7', async () => {
    const fc = await forecastOccupancy({
      property: { id: 'p-low' },
      history: makeSeries({ values: [0.5, 0.45, 0.4, 0.42, 0.4, 0.38] }),
      horizon: { steps: 3 },
    });
    expect(String(fc.meta?.['recommendation'] ?? '')).toMatch(/marketing/i);
  });
});

describe('re-forecasters / churn', () => {
  it('clamps to [0,1] and reports max-churn', async () => {
    const fc = await forecastChurn({
      tenant: { id: 't1' },
      history: makeSeries({ values: [0.1, 0.15, 0.2, 0.22, 0.25, 0.3] }),
      horizon: { steps: 4 },
    });
    expect(fc.modelKind).toBe('re-churn');
    for (const p of fc.points) {
      expect(p.point).toBeGreaterThanOrEqual(0);
      expect(p.point).toBeLessThanOrEqual(1);
    }
    expect(typeof fc.meta?.['maxChurnProbabilityNextHorizon']).toBe('number');
  });
});

describe('re-forecasters / maintenance', () => {
  it('keeps point predictions non-negative', async () => {
    const fc = await forecastMaintenanceFailure({
      asset: { id: 'asset-1', ageDays: 5000 },
      history: makeSeries({ values: [0, 0, 1, 0, 0, 1, 1, 0] }),
      capex: { initial: 1000, amortPerPeriod: 50 },
      horizon: { steps: 4 },
    });
    expect(fc.modelKind).toBe('re-maintenance');
    for (const p of fc.points) expect(p.point).toBeGreaterThanOrEqual(0);
    expect(typeof fc.meta?.['totalExpectedEvents']).toBe('number');
  });

  it('applies an age uplift for older assets', async () => {
    const young = await forecastMaintenanceFailure({
      asset: { id: 'asset-young', ageDays: 100 },
      history: makeSeries({ values: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5] }),
      horizon: { steps: 3 },
    });
    const old = await forecastMaintenanceFailure({
      asset: { id: 'asset-old', ageDays: 20000 },
      history: makeSeries({ values: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5] }),
      horizon: { steps: 3 },
    });
    expect(Number(old.meta?.['ageUplift'] ?? 0)).toBeGreaterThan(
      Number(young.meta?.['ageUplift'] ?? 0),
    );
  });
});

describe('re-forecasters / energy consumption', () => {
  it('returns non-negative kWh forecast', async () => {
    const fc = await forecastEnergyConsumption({
      unit: { id: 'u-en' },
      history: makeSeries({
        values: [100, 110, 120, 105, 95, 110, 130, 140],
        unit: 'kWh',
      }),
      horizon: { steps: 3 },
    });
    expect(fc.modelKind).toBe('re-energy');
    for (const p of fc.points) expect(p.point).toBeGreaterThanOrEqual(0);
  });

  it('computes a weather coefficient when HDD/CDD is supplied', async () => {
    const fc = await forecastEnergyConsumption({
      unit: { id: 'u-en-w' },
      history: makeSeries({ values: [100, 120, 150, 200, 180, 130, 110, 105] }),
      weather: makeSeries({ values: [0, 5, 10, 15, 12, 7, 3, 2] }),
      horizon: { steps: 2 },
    });
    expect(typeof fc.meta?.['weatherCoefficient']).toBe('number');
    expect(Number(fc.meta?.['weatherCoefficient'])).toBeGreaterThan(0);
  });
});

describe('re-forecasters / market cycle', () => {
  it('labels the cycle phase via recent trend', async () => {
    const expansion = await forecastMarketCycle({
      region: { id: 'r-up', jurisdiction: 'TZ' },
      history: makeSeries({ values: [1, 2, 3, 4, 5, 6, 7, 8] }),
      horizon: { steps: 3 },
    });
    const contraction = await forecastMarketCycle({
      region: { id: 'r-down', jurisdiction: 'TZ' },
      history: makeSeries({ values: [8, 7, 6, 5, 4, 3, 2, 1] }),
      horizon: { steps: 3 },
    });
    expect(['expansion', 'recovery']).toContain(expansion.meta?.['cyclePhase']);
    expect(['contraction', 'recession']).toContain(contraction.meta?.['cyclePhase']);
  });

  it('applies a bounded macro adjustment', async () => {
    const fc = await forecastMarketCycle({
      region: { id: 'r-macro', jurisdiction: 'KE' },
      history: makeSeries({ values: [1, 2, 3, 4, 5, 6, 7, 8] }),
      macro: makeSeries({ values: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7] }),
      horizon: { steps: 2 },
    });
    const adj = Math.abs(Number(fc.meta?.['macroAdjustmentPct'] ?? 0));
    expect(adj).toBeLessThanOrEqual(0.05);
  });

  it('rejects too-short history', async () => {
    await expect(forecastMarketCycle({
      region: { id: 'r-x', jurisdiction: 'TZ' },
      history: makeSeries({ values: [1, 2, 3, 4] }),
      horizon: { steps: 2 },
    })).rejects.toThrow();
  });
});

describe('re-forecasters / jurisdictional cap helpers', () => {
  it('looks up the TZ cap', () => {
    const policy = rentCapFor('TZ');
    expect(policy.maxYoYGrowthPct).toBeLessThanOrEqual(0.20);
    expect(policy.source).toMatch(/TZ/i);
  });

  it('falls back to default for unknown jurisdiction', () => {
    const policy = rentCapFor('ATLANTIS');
    expect(policy.source).toMatch(/default/i);
  });

  it('falls back to country prefix for sub-region codes', () => {
    const policy = rentCapFor('KE-30');
    expect(policy.source).toMatch(/KE/i);
  });

  it('returns capped=true when forecast exceeds the cap', () => {
    const policy = rentCapFor('TZ');
    const res = applyRentCap({ forecast: 2000, priorPeriodValue: 1000, policy });
    expect(res.capped).toBe(true);
    expect(res.value).toBeLessThanOrEqual(1100);
  });

  it('returns capped=false when forecast is within bounds', () => {
    const policy = rentCapFor('TZ');
    const res = applyRentCap({ forecast: 1050, priorPeriodValue: 1000, policy });
    expect(res.capped).toBe(false);
    expect(res.value).toBe(1050);
  });
});
