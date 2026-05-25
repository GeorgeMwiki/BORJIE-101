import { describe, expect, it } from 'vitest';
import {
  createGenericDroneFeedProvider,
  createMapboxSatelliteProvider,
  createMapillaryProvider,
  createPlanetMonthlyProvider,
  createSentinel2Provider,
} from '../imagery/index.js';

describe('imagery — Sentinel-2', () => {
  it('reports live=false without creds', () => {
    const provider = createSentinel2Provider({} as NodeJS.ProcessEnv);
    expect(provider.live).toBe(false);
  });

  it('reports live=true with creds', () => {
    const provider = createSentinel2Provider({
      SENTINEL_HUB_CLIENT_ID: 'a',
      SENTINEL_HUB_CLIENT_SECRET: 'b',
    } as unknown as NodeJS.ProcessEnv);
    expect(provider.live).toBe(true);
  });

  it('mock returns 1 image per month in range', async () => {
    const provider = createSentinel2Provider({} as NodeJS.ProcessEnv);
    const out = await provider.getTimeSeries({
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      dateRange: { from: '2026-01-01T00:00:00Z', to: '2026-03-31T23:59:59Z' },
    });
    expect(out.length).toBe(3);
    expect(out[0]?.providerId).toBe('sentinel-2');
  });
});

describe('imagery — Mapbox Satellite', () => {
  it('returns 1 tile per call', async () => {
    const provider = createMapboxSatelliteProvider({} as NodeJS.ProcessEnv);
    const out = await provider.getTimeSeries({
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      dateRange: { from: '2026-01-01T00:00:00Z', to: '2026-03-31T23:59:59Z' },
    });
    expect(out.length).toBe(1);
  });

  it('embeds the access token into the URL when live', async () => {
    const provider = createMapboxSatelliteProvider({
      MAPBOX_ACCESS_TOKEN: 'tok',
    } as unknown as NodeJS.ProcessEnv);
    const out = await provider.getTimeSeries({
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      dateRange: { from: '2026-01-01T00:00:00Z', to: '2026-03-31T23:59:59Z' },
    });
    expect(out[0]?.tileUrl).toContain('access_token=tok');
  });
});

describe('imagery — Mapillary', () => {
  it('returns deterministic pano for coordinates', async () => {
    const provider = createMapillaryProvider({} as NodeJS.ProcessEnv);
    const pano = await provider.getPano({ type: 'Point', coordinates: [36.82, -1.28] });
    expect(pano?.providerId).toBe('mapillary');
    expect(pano?.panoId).toContain('mapillary_mock');
  });

  it('uses live id when token present', async () => {
    const provider = createMapillaryProvider({
      MAPILLARY_ACCESS_TOKEN: 'x',
    } as unknown as NodeJS.ProcessEnv);
    const pano = await provider.getPano({ type: 'Point', coordinates: [36.82, -1.28] });
    expect(pano?.panoId).toContain('mapillary_live');
  });
});

describe('imagery — generic drone', () => {
  it('returns empty registry by default', async () => {
    const provider = createGenericDroneFeedProvider();
    const out = await provider.listFootage({});
    expect(out).toEqual([]);
  });
});

describe('imagery — Planet monthly', () => {
  it('mock returns 1 image per month with 4m resolution', async () => {
    const provider = createPlanetMonthlyProvider({} as NodeJS.ProcessEnv);
    const out = await provider.getTimeSeries({
      bbox: { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 },
      dateRange: { from: '2026-01-01T00:00:00Z', to: '2026-02-28T23:59:59Z' },
    });
    expect(out.length).toBe(2);
    expect(out[0]?.resolutionM).toBe(4);
  });
});
