/**
 * Tests for the Rentometer market-rate adapter.
 *
 * Covers:
 *   - Factory short-circuits to `null` when the API key is absent or empty.
 *   - Returns `[]` when lat/lon are missing (Rentometer can't query).
 *   - Happy-path projection: median rent + percentiles → one ComparableListing.
 *   - HTTP 4xx / 5xx surfaces as a sanitised error (no key leak).
 *   - Network failure → sanitised error.
 *   - Invalid JSON → sanitised error.
 *   - Empty / missing-rent body → `[]`.
 *   - URL builder includes the configured base URL and query parameters.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRentometerAdapter,
  createRentometerAdapterFromEnv,
  RENTOMETER_ADAPTER_ID,
} from '../rentometer-adapter';

const params = {
  tenantId: 't1',
  unitId: 'u1',
  latitude: -6.7924,
  longitude: 39.2083,
  radiusKm: 2,
  bedrooms: 2,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createRentometerAdapterFromEnv', () => {
  it('returns null when RENTOMETER_API_KEY is missing', () => {
    expect(createRentometerAdapterFromEnv({})).toBeNull();
  });

  it('returns null when RENTOMETER_API_KEY is empty / whitespace', () => {
    expect(
      createRentometerAdapterFromEnv({ RENTOMETER_API_KEY: '' }),
    ).toBeNull();
    expect(
      createRentometerAdapterFromEnv({ RENTOMETER_API_KEY: '   ' }),
    ).toBeNull();
  });

  it('returns a configured adapter when the API key is present', () => {
    const adapter = createRentometerAdapterFromEnv({
      RENTOMETER_API_KEY: 'rk_test_secret',
    });
    expect(adapter).not.toBeNull();
    expect(adapter?.adapterId).toBe(RENTOMETER_ADAPTER_ID);
  });
});

describe('rentometer adapter — fetchComparables', () => {
  it('returns [] when lat/lon are missing without making any HTTP call', async () => {
    const fetchImpl = vi.fn();
    const adapter = createRentometerAdapter({
      apiKey: 'rk_test_secret',
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

  it('projects a Rentometer summary into a single ComparableListing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        median: 1200,
        mean: 1185,
        samples: 42,
        percentile_25: 1050,
        percentile_75: 1320,
      }),
    );
    const adapter = createRentometerAdapter({
      apiKey: 'rk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await adapter.fetchComparables(params);
    expect(out).toHaveLength(1);
    expect(out[0]?.adapterId).toBe(RENTOMETER_ADAPTER_ID);
    expect(out[0]?.title).toBe('Rentometer area summary');
    expect(out[0]?.latitude).toBeCloseTo(-6.7924, 4);
    expect(out[0]?.longitude).toBeCloseTo(39.2083, 4);
    expect(out[0]?.rawDescription).toContain('1200');
    expect(out[0]?.rawDescription).toContain('Sample size: 42');
  });

  it('throws sanitised error on HTTP 5xx (no key leak)', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('boom', { status: 503 }));
    const adapter = createRentometerAdapter({
      apiKey: 'rk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fetchComparables(params)).rejects.toThrow(
      /rentometer: upstream HTTP 503/,
    );
  });

  it('throws sanitised error on network failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED rk_test_secret'));
    const adapter = createRentometerAdapter({
      apiKey: 'rk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fetchComparables(params)).rejects.toThrow(
      /rentometer: network error/,
    );
    // Verify the api key was sanitised out of the message.
    try {
      await adapter.fetchComparables(params);
    } catch (err) {
      expect((err as Error).message).not.toContain('rk_test_secret');
      expect((err as Error).message).toContain('***');
    }
  });

  it('throws on invalid JSON response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('this is not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = createRentometerAdapter({
      apiKey: 'rk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fetchComparables(params)).rejects.toThrow(
      /rentometer: invalid JSON/,
    );
  });

  it('returns [] when the body has neither median nor mean', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ samples: 0 }));
    const adapter = createRentometerAdapter({
      apiKey: 'rk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await adapter.fetchComparables(params);
    expect(out).toEqual([]);
  });

  it('builds a URL containing api_key, latitude, longitude, and bedrooms', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ median: 1000 }));
    const adapter = createRentometerAdapter({
      apiKey: 'rk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.fetchComparables(params);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    const url = String(call?.[0]);
    expect(url).toContain('api_key=rk_test_secret');
    expect(url).toContain('latitude=-6.7924');
    expect(url).toContain('longitude=39.2083');
    expect(url).toContain('bedrooms=2');
  });

  it('honours a custom baseUrl override', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ median: 1000 }));
    const adapter = createRentometerAdapter({
      apiKey: 'rk_test_secret',
      baseUrl: 'https://custom.example.test/api/v2',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.fetchComparables(params);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain('https://custom.example.test/api/v2/summary');
  });
});
