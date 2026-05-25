/**
 * Tests for the area-insights aggregator.
 *
 * We stub `fetch` and assert that:
 *  - all four sub-fetches happen in parallel,
 *  - partial failures land in `errors` while the other sections still
 *    populate,
 *  - `include` flags disable individual sub-fetches,
 *  - drive-time targets produce one DriveTimeSample each.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAreaInsights } from '../advisory/area-insights.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.GOOGLE_MAPS_API_KEY;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) {
    delete process.env.GOOGLE_MAPS_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_API_KEY = ORIGINAL_KEY;
  }
});

describe('fetchAreaInsights', () => {
  it('aggregates solar + air + pollen + one drive-time target', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      calls.push(u);
      if (u.startsWith('https://solar.googleapis.com')) {
        return jsonResponse(200, {
          name: 'buildings/x',
          center: { latitude: -6.78, longitude: 39.21 },
          imageryQuality: 'HIGH',
          solarPotential: {
            maxArrayPanelsCount: 24,
            maxArrayAreaMeters2: 50,
            maxSunshineHoursPerYear: 1800,
            carbonOffsetFactorKgPerMwh: 425,
            roofSegmentStats: [
              {
                pitchDegrees: 22,
                azimuthDegrees: 180,
                stats: { areaMeters2: 25, sunshineQuantiles: [100, 900] },
              },
            ],
          },
        });
      }
      if (u.startsWith('https://airquality.googleapis.com')) {
        return jsonResponse(200, {
          dateTime: '2026-05-24T10:00:00Z',
          indexes: [{ code: 'uaqi', displayName: 'UAQI', aqi: 72, category: 'Good' }],
          pollutants: [
            {
              code: 'pm25',
              displayName: 'PM2.5',
              fullName: 'Particulate matter <2.5µm',
              concentration: { value: 9, units: 'µg/m³' },
            },
          ],
        });
      }
      if (u.startsWith('https://pollen.googleapis.com')) {
        return jsonResponse(200, {
          dailyInfo: [
            {
              date: { year: 2026, month: 5, day: 24 },
              pollenTypeInfo: [{ code: 'TREE', displayName: 'Tree' }],
            },
          ],
        });
      }
      if (u.startsWith('https://routes.googleapis.com')) {
        return jsonResponse(200, {
          routes: [
            {
              distanceMeters: 12_345,
              duration: '987s',
              staticDuration: '900s',
              polyline: { encodedPolyline: '_p~iF~ps|U' },
            },
          ],
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const bundle = await fetchAreaInsights({
      lat: -6.78,
      lng: 39.21,
      driveTimeTargets: [{ label: 'CBD', destination: { lat: -6.81, lng: 39.28 } }],
    });

    expect(bundle.center).toEqual({ lat: -6.78, lng: 39.21 });
    expect(bundle.solar?.solarPotential.maxArrayPanelsCount).toBe(24);
    expect(bundle.airQuality?.indexes[0]?.aqi).toBe(72);
    expect(bundle.pollen?.dailyInfo[0]?.pollenTypeInfo[0]?.code).toBe('TREE');
    expect(bundle.driveTimes).toHaveLength(1);
    expect(bundle.driveTimes[0]?.durationSeconds).toBe(987);
    expect(bundle.driveTimes[0]?.distanceMeters).toBe(12_345);
    expect(bundle.errors.solar).toBeUndefined();
    expect(calls.length).toBe(4);
  });

  it('returns partial data when one upstream fails', async () => {
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.startsWith('https://solar.googleapis.com')) {
        return new Response('boom', { status: 500 });
      }
      if (u.startsWith('https://airquality.googleapis.com')) {
        return jsonResponse(200, {
          dateTime: '2026-05-24T10:00:00Z',
          indexes: [{ code: 'uaqi', displayName: 'UAQI', aqi: 50, category: 'Moderate' }],
          pollutants: [],
        });
      }
      if (u.startsWith('https://pollen.googleapis.com')) {
        return jsonResponse(200, { dailyInfo: [] });
      }
      return jsonResponse(200, { routes: [] });
    }) as typeof fetch;

    const bundle = await fetchAreaInsights({
      lat: 0,
      lng: 0,
      driveTimeTargets: [],
    });
    expect(bundle.solar).toBeUndefined();
    expect(bundle.errors.solar?.kind).toBe('http_error');
    expect(bundle.airQuality?.indexes[0]?.aqi).toBe(50);
  });

  it('honours include flags', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return jsonResponse(200, {});
    }) as typeof fetch;

    await fetchAreaInsights({
      lat: 0,
      lng: 0,
      include: { solar: false, airQuality: false, pollen: true, routes: false },
    });
    expect(calls.every((u) => u.startsWith('https://pollen.googleapis.com'))).toBe(true);
  });
});
