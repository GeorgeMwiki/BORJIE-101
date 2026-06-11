/**
 * Providers — registry behaviour + the TSFM HTTP adapter under an
 * injected fetch (no network, no secrets).
 */

import { describe, it, expect } from 'vitest';
import { createProviderRegistry } from '../registry.js';
import { createClassicalProvider } from '../classical-provider.js';
import {
  createTsfmHttpProvider,
  type FetchLike,
} from '../tsfm-http-provider.js';
import type { TimeSeries } from '../../types.js';

const series: TimeSeries = {
  seriesId: 's',
  values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  seasonLength: 1,
};

describe('provider registry', () => {
  it('always contains a classical floor (zero-config)', async () => {
    const reg = createProviderRegistry();
    expect(reg.floor().kind).toBe('classical');
    const health = await reg.floor().health();
    expect(health.available).toBe(true);
  });

  it('register returns a NEW registry (immutable)', () => {
    const reg = createProviderRegistry();
    const extra = createClassicalProvider({ method: 'seasonal_naive' });
    const reg2 = reg.register(extra);
    expect(reg).not.toBe(reg2);
    expect(reg.get(extra.name)).toBeUndefined();
    expect(reg2.get(extra.name)).toBeDefined();
  });
});

describe('TSFM HTTP provider — config-gated, secret-safe', () => {
  it('is UNAVAILABLE without a baseUrl (degrades, never fabricates)', async () => {
    const p = createTsfmHttpProvider({ model: 'chronos-2' });
    const health = await p.health();
    expect(health.available).toBe(false);
    await expect(p.forecast(series, 3, [0.5])).rejects.toThrow(/not configured/);
  });

  it('reports no_api_key for a hosted API without a key', async () => {
    const p = createTsfmHttpProvider({
      model: 'timesfm-2.5',
      baseUrl: 'https://api.example',
      kind: 'tsfm-api',
      fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({}) })) as FetchLike,
    });
    const health = await p.health();
    expect(health.status).toBe('no_api_key');
  });

  it('forecasts through an injected fetch and validates the response', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        modelVersion: 'chronos-2-test',
        steps: [
          { point: 11, quantiles: { '0.1': 9, '0.9': 13 } },
          { point: 12, quantiles: { '0.1': 10, '0.9': 14 } },
        ],
      }),
    });
    const p = createTsfmHttpProvider({
      model: 'chronos-2',
      baseUrl: 'https://sidecar.local',
      kind: 'tsfm-selfhost',
      fetchImpl,
    });
    expect((await p.health()).available).toBe(true);
    const raw = await p.forecast(series, 2, [0.1, 0.9]);
    expect(raw.model).toBe('chronos-2');
    expect(raw.modelVersion).toBe('chronos-2-test');
    expect(raw.steps).toHaveLength(2);
    expect(raw.steps[0]!.quantiles['0.1']).toBe(9);
    expect(raw.steps[0]!.quantiles['0.9']).toBe(13);
  });

  it('throws (never fabricates) on a non-ok HTTP response', async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    });
    const p = createTsfmHttpProvider({
      model: 'toto-2',
      baseUrl: 'https://sidecar.local',
      kind: 'tsfm-selfhost',
      fetchImpl,
    });
    await expect(p.forecast(series, 2, [0.5])).rejects.toThrow(/HTTP 503/);
  });
});

describe('classical provider quantiles', () => {
  it('produces ordered preliminary quantiles around the point', async () => {
    const p = createClassicalProvider({ method: 'ets_theta' });
    const raw = await p.forecast(series, 3, [0.1, 0.5, 0.9]);
    for (const step of raw.steps) {
      expect(step.quantiles['0.1']!).toBeLessThanOrEqual(step.point);
      expect(step.quantiles['0.9']!).toBeGreaterThanOrEqual(step.point);
    }
  });
});
