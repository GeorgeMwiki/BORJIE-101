/**
 * Engine end-to-end — runs with ZERO config (classical floor only) and
 * with the target registry providing coverage. Also exercises zod
 * validation on the FORECAST PORT.
 */

import { describe, it, expect } from 'vitest';
import { createForecastEngine } from '../engine.js';
import {
  ForecastRequestSchema,
  TimeSeriesSchema,
  ForecastResultSchema,
} from '../types.js';
import type { ForecastRequest, TimeSeries } from '../types.js';
import { getTarget, FORECAST_TARGETS, highRiskTargets } from '../targets/registry.js';

function trendSeries(n: number): TimeSeries {
  return {
    seriesId: 'cashflow',
    values: Array.from({ length: n }, (_, i) => 1000 + 5 * i),
    seasonLength: 1,
    currencyCode: 'TZS',
  };
}

describe('createForecastEngine — zero-config run', () => {
  it('forecasts with the classical floor and returns a valid ForecastResult', async () => {
    const engine = createForecastEngine();
    const req: ForecastRequest = {
      tenantId: 'tenant-1',
      target: 'mining.A5.treasury_cashflow',
      series: trendSeries(40),
      horizon: 7,
    };
    const result = await engine.forecast(req);
    // The output validates against the public schema.
    expect(() => ForecastResultSchema.parse(result)).not.toThrow();
    expect(result.points).toHaveLength(7);
    expect(result.intervals).toHaveLength(7);
    expect(result.evidenceIds.length).toBeGreaterThanOrEqual(1);
    // currency is carried as metadata only (no formatting in the engine).
    expect(result.currencyCode).toBe('TZS');
  });

  it('adopts the target registry coverage when none is supplied', async () => {
    const engine = createForecastEngine();
    // A10 licence target recommends 0.95 coverage.
    const req: ForecastRequest = {
      tenantId: 'tenant-1',
      target: 'mining.A10.licence_deadline',
      series: trendSeries(40),
      horizon: 5,
    };
    const result = await engine.forecast(req);
    expect(result.conformalCoverage).toBeCloseTo(0.95, 6);
  });

  it('handles a global (tenantId = null) series', async () => {
    const engine = createForecastEngine();
    const result = await engine.forecast({
      tenantId: null,
      target: 'mining.A1.commodity_price',
      series: { seriesId: 'gold', values: trendSeries(30).values },
      horizon: 3,
    });
    expect(result.tenantId).toBeNull();
  });
});

describe('FORECAST PORT zod validation', () => {
  it('rejects a TimeSeries whose timestamps length mismatches values', () => {
    const bad = {
      seriesId: 's',
      values: [1, 2, 3],
      timestamps: ['2026-01-01', '2026-01-02'],
    };
    expect(() => TimeSeriesSchema.parse(bad)).toThrow();
  });

  it('rejects a horizon < 1', () => {
    expect(() =>
      ForecastRequestSchema.parse({
        tenantId: 't',
        target: 'x',
        series: { seriesId: 's', values: [1, 2] },
        horizon: 0,
      }),
    ).toThrow();
  });

  it('accepts a valid request', () => {
    expect(() =>
      ForecastRequestSchema.parse({
        tenantId: 't',
        target: 'mining.A1.commodity_price',
        series: { seriesId: 's', values: [1, 2, 3], seasonLength: 1 },
        horizon: 4,
        quantiles: [0.1, 0.5, 0.9],
        targetCoverage: 0.9,
      }),
    ).not.toThrow();
  });
});

describe('target registry', () => {
  it('exposes mining + real-estate targets with unique ids', () => {
    const ids = new Set(FORECAST_TARGETS.map((t) => t.id));
    expect(ids.size).toBe(FORECAST_TARGETS.length);
    expect(getTarget('mining.A6.royalty_accrual')?.method).toBe(
      'rule-based+overlay',
    );
    expect(getTarget('re.B1.avm_valuation')?.domain).toBe('real-estate');
  });

  it('royalty + licence + treasury + safety are HIGH-risk', () => {
    const high = new Set(highRiskTargets().map((t) => t.id));
    expect(high.has('mining.A6.royalty_accrual')).toBe(true);
    expect(high.has('mining.A10.licence_deadline')).toBe(true);
    expect(high.has('mining.A5.treasury_cashflow')).toBe(true);
    expect(high.has('mining.A9.safety_incident')).toBe(true);
  });

  it('safety target routes to intermittent (Croston/TSB family)', () => {
    expect(getTarget('mining.A9.safety_incident')?.method).toBe('intermittent');
  });
});
