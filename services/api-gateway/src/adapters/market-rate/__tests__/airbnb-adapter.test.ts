/**
 * Tests for the Airbnb market-rate adapter.
 *
 * Covers:
 *   - Factory short-circuits to `null` when API key absent.
 *   - Returns `[]` when lat/lon missing.
 *   - Happy-path projection: nightly → monthly estimate, lat/lng surfaced.
 *   - Listings without rate are dropped.
 *   - HTTP non-2xx throws sanitised error.
 *   - Network failure → sanitised error.
 *   - Invalid JSON → sanitised error.
 *   - URL builder forms a bounding box and forwards bedroom filter.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createAirbnbAdapter,
  createAirbnbAdapterFromEnv,
  AIRBNB_ADAPTER_ID,
} from '../airbnb-adapter';

const params = {
  tenantId: 't1',
  unitId: 'u1',
  latitude: 40.7128,
  longitude: -74.006,
  radiusKm: 2,
  bedrooms: 2,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createAirbnbAdapterFromEnv', () => {
  it('returns null when AIRBNB_API_KEY is missing', () => {
    expect(createAirbnbAdapterFromEnv({})).toBeNull();
  });

  it('returns a configured adapter when key is present', () => {
    const adapter = createAirbnbAdapterFromEnv({
      AIRBNB_API_KEY: 'ak_test_secret',
    });
    expect(adapter?.adapterId).toBe(AIRBNB_ADAPTER_ID);
  });
});

describe('airbnb adapter — fetchComparables', () => {
  it('returns [] when lat/lon are missing without making any HTTP call', async () => {
    const fetchImpl = vi.fn();
    const adapter = createAirbnbAdapter({
      apiKey: 'ak_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await adapter.fetchComparables({
      ...params,
      latitude: null,
      longitude: null,
    });
    expect(out).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('projects results[] with monthly estimate annotation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            id: 'a1',
            name: 'Cosy 2BR loft',
            price: { rate: 110, total: 770 },
            bedrooms: 2,
            bathrooms: 1,
            lat: 40.71,
            lng: -74.0,
            url: 'https://airbnb.test/a1',
          },
          {
            id: 'a2',
            title: 'Studio',
            rate: 90,
            bedrooms: 0,
            lat: 40.72,
            lng: -74.01,
          },
          { id: 'a3', name: 'No price' },
        ],
      }),
    );
    const adapter = createAirbnbAdapter({
      apiKey: 'ak_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await adapter.fetchComparables(params);
    expect(out).toHaveLength(2);
    expect(out[0]?.adapterId).toBe(AIRBNB_ADAPTER_ID);
    expect(out[0]?.title).toBe('Cosy 2BR loft');
    expect(out[0]?.rawDescription).toContain('Nightly rate: 110');
    // 110 * 30 = 3300; monthlyRentMinor approx 330000
    expect(out[0]?.rawDescription).toContain('Monthly estimate (30-night): 3300');
    expect(out[0]?.rawDescription).toContain('monthlyRentMinor approx 330000');
  });

  it('throws sanitised error on HTTP 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('upstream-down', { status: 502 }),
    );
    const adapter = createAirbnbAdapter({
      apiKey: 'ak_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fetchComparables(params)).rejects.toThrow(
      /airbnb: upstream HTTP 502/,
    );
  });

  it('throws sanitised error on network failure (no key in message)', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('connection refused — token ak_test_secret'));
    const adapter = createAirbnbAdapter({
      apiKey: 'ak_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    try {
      await adapter.fetchComparables(params);
      throw new Error('expected throw');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('airbnb: network error');
      expect(msg).not.toContain('ak_test_secret');
      expect(msg).toContain('***');
    }
  });

  it('throws on invalid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const adapter = createAirbnbAdapter({
      apiKey: 'ak_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fetchComparables(params)).rejects.toThrow(
      /airbnb: invalid JSON/,
    );
  });

  it('returns [] when response has no results array', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const adapter = createAirbnbAdapter({
      apiKey: 'ak_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await adapter.fetchComparables(params);
    expect(out).toEqual([]);
  });

  it('builds URL with bounding-box parameters and bedrooms filter', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    const adapter = createAirbnbAdapter({
      apiKey: 'ak_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.fetchComparables(params);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain('ne_lat=');
    expect(url).toContain('sw_lat=');
    expect(url).toContain('minBedrooms=2');
    expect(url).toContain('currency=USD');
  });
});
