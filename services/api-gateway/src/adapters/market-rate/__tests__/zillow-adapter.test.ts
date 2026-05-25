/**
 * Tests for the Zillow market-rate adapter.
 *
 * Covers:
 *   - Factory short-circuits to `null` when API key absent.
 *   - Returns `[]` when lat/lon missing.
 *   - Happy-path: `props[]` projection into ComparableListing[] (rent
 *     pulled from `rent` / `rentZestimate` / `price`).
 *   - HTTP non-2xx throws with sanitised message.
 *   - Network failure → sanitised error.
 *   - Listings without rent are dropped.
 *   - URL builder forms a bounding box from lat/lon + radiusKm and
 *     forwards bedrooms.
 *   - Custom api header (e.g. Authorization) is supported.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createZillowAdapter,
  createZillowAdapterFromEnv,
  ZILLOW_ADAPTER_ID,
} from '../zillow-adapter';

const params = {
  tenantId: 't1',
  unitId: 'u1',
  latitude: 47.6062,
  longitude: -122.3321,
  radiusKm: 2,
  bedrooms: 2,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createZillowAdapterFromEnv', () => {
  it('returns null when ZILLOW_API_KEY is missing', () => {
    expect(createZillowAdapterFromEnv({})).toBeNull();
  });

  it('returns a configured adapter when key is present', () => {
    const adapter = createZillowAdapterFromEnv({
      ZILLOW_API_KEY: 'zk_test_secret',
    });
    expect(adapter?.adapterId).toBe(ZILLOW_ADAPTER_ID);
  });
});

describe('zillow adapter — fetchComparables', () => {
  it('returns [] when lat/lon are missing without making any HTTP call', async () => {
    const fetchImpl = vi.fn();
    const adapter = createZillowAdapter({
      apiKey: 'zk_test_secret',
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

  it('projects props[] into ComparableListing[]', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        props: [
          {
            zpid: 12345,
            streetAddress: '101 Pine St',
            rent: 2400,
            bedrooms: 2,
            bathrooms: 1,
            livingArea: 800,
            latitude: 47.605,
            longitude: -122.331,
            detailUrl: 'https://www.zillow.com/homedetails/101-pine-12345_zpid/',
          },
          {
            zpid: 67890,
            streetAddress: '202 Oak Ave',
            rentZestimate: 2200,
            bedrooms: 2,
            latitude: 47.61,
            longitude: -122.33,
          },
          {
            // no rent, no rentZestimate, no price → dropped
            zpid: 'no-rent',
            streetAddress: 'No rent listed',
          },
        ],
      }),
    );
    const adapter = createZillowAdapter({
      apiKey: 'zk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await adapter.fetchComparables(params);
    expect(out).toHaveLength(2);
    expect(out[0]?.adapterId).toBe(ZILLOW_ADAPTER_ID);
    expect(out[0]?.url).toContain('zillow.com');
    expect(out[0]?.rawDescription).toContain('2400');
    expect(out[1]?.rawDescription).toContain('2200');
  });

  it('returns [] when response has no props/results', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}));
    const adapter = createZillowAdapter({
      apiKey: 'zk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const out = await adapter.fetchComparables(params);
    expect(out).toEqual([]);
  });

  it('throws sanitised error on HTTP 4xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('forbidden', { status: 403 }),
    );
    const adapter = createZillowAdapter({
      apiKey: 'zk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fetchComparables(params)).rejects.toThrow(
      /zillow: upstream HTTP 403/,
    );
  });

  it('throws sanitised error on network failure (no key in message)', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('zk_test_secret leaked'));
    const adapter = createZillowAdapter({
      apiKey: 'zk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    try {
      await adapter.fetchComparables(params);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as Error).message).toContain('zillow: network error');
      expect((err as Error).message).not.toContain('zk_test_secret');
    }
  });

  it('throws on invalid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const adapter = createZillowAdapter({
      apiKey: 'zk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(adapter.fetchComparables(params)).rejects.toThrow(
      /zillow: invalid JSON/,
    );
  });

  it('builds URL with bounding box + bedroom filters', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ props: [] }));
    const adapter = createZillowAdapter({
      apiKey: 'zk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.fetchComparables(params);
    const url = String(fetchImpl.mock.calls[0]?.[0]);
    expect(url).toContain('north=');
    expect(url).toContain('south=');
    expect(url).toContain('east=');
    expect(url).toContain('west=');
    expect(url).toContain('status_type=ForRent');
    expect(url).toContain('bedsMin=2');
  });

  it('uses the configured API header (RapidAPI default)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ props: [] }));
    const adapter = createZillowAdapter({
      apiKey: 'zk_test_secret',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.fetchComparables(params);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-RapidAPI-Key']).toBe(
      'zk_test_secret',
    );
  });

  it('respects an alternate api header name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ props: [] }));
    const adapter = createZillowAdapter({
      apiKey: 'zk_test_secret',
      apiHeader: 'Authorization',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.fetchComparables(params);
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'zk_test_secret',
    );
  });
});
