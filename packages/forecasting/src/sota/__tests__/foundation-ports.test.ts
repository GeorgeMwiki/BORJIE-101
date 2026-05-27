/**
 * Foundation-model port contract tests.
 *
 * Every port (TimeGPT, Chronos, MOIRAI, Prophet, ARIMA, N-BEATS)
 * runs against a stubbed Fetcher or SidecarPort that returns a
 * known-good or known-bad payload. We verify:
 *  - happy-path parses to the canonical ForecastResult shape
 *  - non-OK HTTP / malformed payload triggers a hard error
 *  - response-length mismatch is caught
 *
 * Wave SOTA-FORECAST (Mr. Mwikila). External HTTP is stubbed —
 * live calls are wired by the host service composition root.
 */

import { describe, it, expect } from 'vitest';
import { createTimeGptForecaster } from '../models/timegpt-port.js';
import { createChronosForecaster } from '../models/chronos-port.js';
import { createMoiraiForecaster } from '../models/moirai-port.js';
import { createProphetForecaster } from '../models/prophet-port.js';
import { createArimaForecaster } from '../models/arima-port.js';
import { createNBeatsForecaster } from '../models/nbeats-port.js';
import type {
  Fetcher,
  SidecarPort,
  TimeSeries,
} from '../types.js';

const ANCHOR = Date.parse('2026-01-01T00:00:00Z');

function dailySeries(values: ReadonlyArray<number>): TimeSeries {
  return {
    id: 'fix-fdn',
    frequency: 'daily',
    points: values.map((y, i) => ({
      t: new Date(ANCHOR + i * 86_400_000).toISOString(),
      y,
    })),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetcher(body: unknown, status = 200): Fetcher {
  return async () => jsonResponse(body, status);
}

function fakeSidecar(payload: Readonly<Record<string, unknown>>): SidecarPort {
  return {
    invoke: async () => payload,
  };
}

describe('TimeGPT port', () => {
  it('parses a Nixtla response into ForecastResult', async () => {
    const fetcher = fakeFetcher({
      value: [101, 102, 103],
      'lo-80': [99, 100, 101],
      'hi-80': [103, 104, 105],
      'lo-95': [97, 98, 99],
      'hi-95': [105, 106, 107],
    });
    const fc = createTimeGptForecaster({ fetcher, apiKey: 'k' });
    const r = await fc.predict({
      series: dailySeries([10, 11, 12, 13]),
      horizon: { steps: 3 },
    });
    expect(r.model).toBe('timegpt');
    expect(r.point).toEqual([101, 102, 103]);
    expect(r.intervals_95[0]).toEqual({ step: 1, lower: 97, upper: 105 });
  });

  it('throws on HTTP non-OK', async () => {
    const fc = createTimeGptForecaster({
      fetcher: fakeFetcher({}, 503),
      apiKey: 'k',
    });
    await expect(
      fc.predict({ series: dailySeries([1, 2, 3]), horizon: { steps: 2 } }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('throws on response-length mismatch', async () => {
    const fc = createTimeGptForecaster({
      fetcher: fakeFetcher({ value: [1, 2] }),
      apiKey: 'k',
    });
    await expect(
      fc.predict({ series: dailySeries([1, 2, 3]), horizon: { steps: 3 } }),
    ).rejects.toThrow(/length 2/);
  });
});

describe('Chronos port', () => {
  it('parses Amazon Chronos quantile output', async () => {
    const fetcher = fakeFetcher({
      point: [50, 51, 52],
      quantiles: {
        '0.1': [48, 49, 50],
        '0.9': [52, 53, 54],
        '0.025': [46, 47, 48],
        '0.975': [54, 55, 56],
      },
    });
    const fc = createChronosForecaster({ fetcher, endpoint: 'https://x.test' });
    const r = await fc.predict({
      series: dailySeries([40, 42, 44, 46]),
      horizon: { steps: 3 },
    });
    expect(r.model).toBe('chronos');
    expect(r.intervals_80.map((b) => b.lower)).toEqual([48, 49, 50]);
    expect(r.intervals_95.map((b) => b.upper)).toEqual([54, 55, 56]);
  });

  it('throws on malformed Chronos response', async () => {
    const fc = createChronosForecaster({
      fetcher: fakeFetcher({ wrong: 'shape' }),
      endpoint: 'https://x.test',
    });
    await expect(
      fc.predict({ series: dailySeries([1, 2, 3]), horizon: { steps: 2 } }),
    ).rejects.toThrow(/malformed/);
  });
});

describe('MOIRAI port', () => {
  it('derives point/intervals from sample tensor', async () => {
    // 5 samples × 2 prediction-length, lo-skew so the medians shift.
    const samples = [
      [10, 20],
      [11, 21],
      [12, 22],
      [13, 23],
      [14, 24],
    ];
    const fc = createMoiraiForecaster({
      fetcher: fakeFetcher({ samples }),
      endpoint: 'https://moirai.test',
      numSamples: 5,
    });
    const r = await fc.predict({
      series: dailySeries([5, 6, 7, 8]),
      horizon: { steps: 2 },
    });
    expect(r.point).toEqual([12, 22]); // median of [10..14] and [20..24]
    expect(r.intervals_95[0]!.lower).toBeLessThanOrEqual(r.intervals_80[0]!.lower);
    expect(r.intervals_95[0]!.upper).toBeGreaterThanOrEqual(r.intervals_80[0]!.upper);
  });
});

describe('Prophet port', () => {
  it('parses a Meta Prophet sidecar response', async () => {
    const sidecar = fakeSidecar({
      yhat: [100, 105, 110],
      yhat_lower_80: [97, 102, 107],
      yhat_upper_80: [103, 108, 113],
      yhat_lower_95: [94, 99, 104],
      yhat_upper_95: [106, 111, 116],
    });
    const fc = createProphetForecaster({ sidecar });
    const r = await fc.predict({
      series: dailySeries([90, 92, 94, 96]),
      horizon: { steps: 3 },
    });
    expect(r.model).toBe('prophet');
    expect(r.point).toEqual([100, 105, 110]);
    expect(r.intervals_80[1]).toEqual({ step: 2, lower: 102, upper: 108 });
  });

  it('throws when the sidecar response is malformed', async () => {
    const fc = createProphetForecaster({
      sidecar: fakeSidecar({ wrong: 1 }),
    });
    await expect(
      fc.predict({ series: dailySeries([1, 2, 3]), horizon: { steps: 2 } }),
    ).rejects.toThrow(/malformed/);
  });
});

describe('ARIMA port', () => {
  it('parses confidence-interval pairs from statsmodels', async () => {
    const sidecar = fakeSidecar({
      forecast: [10, 11, 12],
      conf_int_80: [
        [9, 11],
        [10, 12],
        [11, 13],
      ],
      conf_int_95: [
        [8, 12],
        [9, 13],
        [10, 14],
      ],
    });
    const fc = createArimaForecaster({ sidecar });
    const r = await fc.predict({
      series: dailySeries([5, 6, 7, 8]),
      horizon: { steps: 3 },
    });
    expect(r.model).toBe('arima');
    expect(r.intervals_95[2]).toEqual({ step: 3, lower: 10, upper: 14 });
  });
});

describe('N-BEATS port', () => {
  it('parses N-HiTS sidecar levels and stamps variant in meta', async () => {
    const sidecar = fakeSidecar({
      forecast: [5, 6, 7, 8],
      lo_80: [4, 5, 6, 7],
      hi_80: [6, 7, 8, 9],
      lo_95: [3, 4, 5, 6],
      hi_95: [7, 8, 9, 10],
    });
    const fc = createNBeatsForecaster({ sidecar, variant: 'nhits' });
    const r = await fc.predict({
      series: dailySeries([0, 1, 2, 3, 4]),
      horizon: { steps: 4 },
    });
    expect(r.model).toBe('nbeats');
    expect(r.modelVersion).toContain('nhits');
    expect(r.point).toEqual([5, 6, 7, 8]);
    expect(r.meta?.['variant']).toBe('nhits');
  });
});
