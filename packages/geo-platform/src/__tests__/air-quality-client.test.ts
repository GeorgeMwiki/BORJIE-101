/**
 * Tests for the Air Quality API client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCurrentConditions } from '../google/air-quality-client.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.GOOGLE_MAPS_API_KEY;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'k';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) {
    delete process.env.GOOGLE_MAPS_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_API_KEY = ORIGINAL_KEY;
  }
});

describe('fetchCurrentConditions', () => {
  it('posts location + extra computations and normalises the response', async () => {
    let capturedBody = '';
    let capturedUrl = '';
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body);
      return jsonResponse(200, {
        dateTime: '2026-05-24T10:00:00Z',
        regionCode: 'tz',
        indexes: [
          {
            code: 'uaqi',
            displayName: 'Universal AQI',
            aqi: 75,
            category: 'Good air quality',
            dominantPollutant: 'pm25',
            color: { red: 0, green: 1, blue: 0 },
          },
        ],
        pollutants: [
          {
            code: 'pm25',
            displayName: 'PM2.5',
            fullName: 'Particulate matter <2.5µm',
            concentration: { value: 9.4, units: 'µg/m³' },
          },
        ],
      });
    }) as typeof fetch;

    const r = await fetchCurrentConditions({ lat: -6.78, lng: 39.21 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.indexes[0]?.aqi).toBe(75);
      expect(r.data.indexes[0]?.color).toEqual({ red: 0, green: 1, blue: 0 });
      expect(r.data.pollutants[0]?.concentration.value).toBe(9.4);
      expect(r.data.regionCode).toBe('tz');
    }
    expect(capturedUrl).toContain('airquality.googleapis.com');
    expect(capturedUrl).toContain('key=k');
    expect(capturedBody).toContain('"latitude":-6.78');
  });

  it('maps non-2xx to structured errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response('no', { status: 429 })) as typeof fetch;
    const r = await fetchCurrentConditions({ lat: 0, lng: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('rate_limited');
  });

  it('falls back to defaults when fields are missing', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, {})) as typeof fetch;
    const r = await fetchCurrentConditions({ lat: 0, lng: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.indexes).toEqual([]);
      expect(r.data.pollutants).toEqual([]);
      expect(typeof r.data.dateTime).toBe('string');
    }
  });

  it('aborts on caller signal', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('abort');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    ) as typeof fetch;

    const promise = fetchCurrentConditions(
      { lat: 0, lng: 0 },
      { signal: controller.signal },
    );
    controller.abort();
    const r = await promise;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('aborted');
  });
});
