/**
 * Tests for the Solar API client.
 *
 * Verifies: missing-key error envelope, success normalisation, 404 →
 * unsupported_region remapping, timeout handling, and the rule that
 * the API key never appears in the error message body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBuildingInsights } from '../google/solar-api-client.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.GOOGLE_MAPS_API_KEY;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  delete process.env.GOOGLE_MAPS_API_KEY;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) {
    delete process.env.GOOGLE_MAPS_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_API_KEY = ORIGINAL_KEY;
  }
});

describe('fetchBuildingInsights', () => {
  it('returns missing_api_key when env var is unset and no override passed', async () => {
    const r = await fetchBuildingInsights({ lat: 37.4, lng: -122.0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('missing_api_key');
    }
  });

  it('normalises a successful response', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'k';
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        name: 'buildings/x',
        center: { latitude: 37.4, longitude: -122.0 },
        imageryQuality: 'HIGH',
        imageryDate: { year: 2024, month: 1, day: 1 },
        solarPotential: {
          maxArrayPanelsCount: 30,
          maxArrayAreaMeters2: 60,
          maxSunshineHoursPerYear: 1900,
          carbonOffsetFactorKgPerMwh: 400,
          roofSegmentStats: [
            {
              pitchDegrees: 30,
              azimuthDegrees: 180,
              stats: { areaMeters2: 25, sunshineQuantiles: [100, 200, 1500] },
            },
          ],
        },
      }),
    ) as typeof fetch;

    const r = await fetchBuildingInsights({ lat: 37.4, lng: -122.0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.solarPotential.maxArrayPanelsCount).toBe(30);
      expect(r.data.solarPotential.roofSegments[0]?.sunshineHoursPerYear).toBe(1500);
      expect(r.data.imageryDate).toEqual({ year: 2024, month: 1, day: 1 });
    }
  });

  it('remaps 404 to unsupported_region', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'k';
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(404, { error: { message: 'No imagery here.' } }),
    ) as typeof fetch;
    const r = await fetchBuildingInsights({ lat: -6.78, lng: 39.21 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('unsupported_region');
  });

  it('returns http_error on other non-2xx', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'k';
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
    const r = await fetchBuildingInsights({ lat: 0, lng: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('http_error');
      expect(r.error.status).toBe(500);
    }
  });

  it('passes apiKey override without reading env', async () => {
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url: unknown) => {
      capturedUrl = String(url);
      return jsonResponse(200, { solarPotential: {} });
    }) as typeof fetch;
    const r = await fetchBuildingInsights(
      { lat: 0, lng: 0 },
      { apiKey: 'override-key' },
    );
    expect(r.ok).toBe(true);
    expect(capturedUrl).toContain('key=override-key');
  });

  it('error messages never include the API key', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'super-secret-key';
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 403 })) as typeof fetch;
    const r = await fetchBuildingInsights({ lat: 0, lng: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toContain('super-secret-key');
    }
  });

  it('returns timeout when the request exceeds the timeout window', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'k';
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      // Wait forever, but resolve / reject on abort.
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('timeout');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as typeof fetch;

    const r = await fetchBuildingInsights({ lat: 0, lng: 0 }, { timeoutMs: 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('timeout');
  });
});
