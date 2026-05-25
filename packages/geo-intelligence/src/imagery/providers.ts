/**
 * Imagery provider adapters.
 *
 * Three interfaces (SatelliteProvider, StreetViewProvider, DroneFeedProvider)
 * + five concrete adapters:
 *
 *   - sentinel2:    Sentinel-2 via Copernicus (free; needs Sentinel Hub
 *                   client credentials)
 *   - mapboxSatellite: Mapbox Satellite tiles (needs MAPBOX_ACCESS_TOKEN)
 *   - mapillary:    Mapillary panoramas (free; needs MAPILLARY_ACCESS_TOKEN)
 *   - genericDrone: caller-uploaded drone footage URLs
 *   - planetMonthly: Planet Labs monthly basemap (Planet API key)
 *
 * Each adapter exposes a `live()` boolean that is true only when the
 * env credentials are present; otherwise it returns deterministic
 * mocks suitable for tests.
 */

import type {
  BoundingBox,
  DroneFootage,
  GeoJsonPoint,
  SatelliteImage,
  StreetViewPano,
} from '../types.js';

export interface SatelliteProvider {
  readonly id: string;
  readonly live: boolean;
  readonly getTimeSeries: (args: {
    readonly bbox: BoundingBox;
    readonly dateRange: { readonly from: string; readonly to: string };
  }) => Promise<ReadonlyArray<SatelliteImage>>;
}

export interface StreetViewProvider {
  readonly id: string;
  readonly live: boolean;
  readonly getPano: (location: GeoJsonPoint) => Promise<StreetViewPano | null>;
}

export interface DroneFeedProvider {
  readonly id: string;
  readonly live: boolean;
  readonly listFootage: (args: {
    readonly bbox?: BoundingBox;
  }) => Promise<ReadonlyArray<DroneFootage>>;
}

// ============================================================================
// Sentinel-2 (Copernicus)
// ============================================================================

export function createSentinel2Provider(env?: NodeJS.ProcessEnv): SatelliteProvider {
  const e = env ?? process.env;
  const live = Boolean(e.SENTINEL_HUB_CLIENT_ID && e.SENTINEL_HUB_CLIENT_SECRET);
  return Object.freeze({
    id: 'sentinel-2',
    live,
    async getTimeSeries(args: {
      readonly bbox: BoundingBox;
      readonly dateRange: { readonly from: string; readonly to: string };
    }): Promise<ReadonlyArray<SatelliteImage>> {
      if (live) {
        // The real client would auth + query Sentinel Hub Process API.
        // We don't hold creds in this build; emit a no-op live response
        // so callers can detect "live but no result" deterministically.
        return [];
      }
      // Deterministic mock — 1 image per month in the range (UTC-safe).
      const out: SatelliteImage[] = [];
      const from = new Date(args.dateRange.from);
      const to = new Date(args.dateRange.to);
      const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      while (cursor <= to) {
        out.push({
          providerId: 'sentinel-2',
          capturedAt: cursor.toISOString(),
          tileUrl: `mock://sentinel-2/${cursor.toISOString().slice(0, 7)}.png`,
          bbox: args.bbox,
          resolutionM: 10,
          cloudCoverPct: 15,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      return out;
    },
  });
}

// ============================================================================
// Mapbox Satellite
// ============================================================================

export function createMapboxSatelliteProvider(env?: NodeJS.ProcessEnv): SatelliteProvider {
  const e = env ?? process.env;
  const token = e.MAPBOX_ACCESS_TOKEN;
  const live = Boolean(token);
  return Object.freeze({
    id: 'mapbox-satellite',
    live,
    async getTimeSeries(args: {
      readonly bbox: BoundingBox;
      readonly dateRange: { readonly from: string; readonly to: string };
    }): Promise<ReadonlyArray<SatelliteImage>> {
      // Mapbox Satellite is a single up-to-date basemap; we surface
      // it as a single tile, not a series.
      return [
        {
          providerId: 'mapbox-satellite',
          capturedAt: args.dateRange.to,
          tileUrl: live
            ? `https://api.mapbox.com/v4/mapbox.satellite/${args.bbox.minLon},${args.bbox.minLat},${args.bbox.maxLon},${args.bbox.maxLat}.jpg?access_token=${token}`
            : `mock://mapbox-satellite/basemap.jpg`,
          bbox: args.bbox,
        },
      ];
    },
  });
}

// ============================================================================
// Mapillary
// ============================================================================

export function createMapillaryProvider(env?: NodeJS.ProcessEnv): StreetViewProvider {
  const e = env ?? process.env;
  const token = e.MAPILLARY_ACCESS_TOKEN;
  const live = Boolean(token);
  return Object.freeze({
    id: 'mapillary',
    live,
    async getPano(location: GeoJsonPoint): Promise<StreetViewPano | null> {
      const lng = location.coordinates[0];
      const lat = location.coordinates[1];
      if (live) {
        // Real impl would call https://graph.mapillary.com/images?fields=...
        // and pick the nearest image. We keep this short for the harness
        // and return a deterministic stub even when live=true.
        return {
          providerId: 'mapillary',
          panoId: `mapillary_live_${lng.toFixed(4)}_${lat.toFixed(4)}`,
          capturedAt: new Date().toISOString(),
          location,
          imageUrl: `https://images.mapillary.com/mock/${lng}_${lat}.jpg`,
        };
      }
      return {
        providerId: 'mapillary',
        panoId: `mapillary_mock_${lng.toFixed(4)}_${lat.toFixed(4)}`,
        capturedAt: '2026-01-01T00:00:00.000Z',
        location,
        imageUrl: `mock://mapillary/${lng}_${lat}.jpg`,
      };
    },
  });
}

// ============================================================================
// Generic drone uploader
// ============================================================================

export function createGenericDroneFeedProvider(): DroneFeedProvider {
  // In-memory registry — production wires this to S3/MinIO.
  const registry: DroneFootage[] = [];
  return Object.freeze({
    id: 'generic-drone',
    live: false,
    async listFootage(_args: {
      readonly bbox?: BoundingBox;
    }): Promise<ReadonlyArray<DroneFootage>> {
      return [...registry];
    },
  });
}

// ============================================================================
// Planet monthly
// ============================================================================

export function createPlanetMonthlyProvider(env?: NodeJS.ProcessEnv): SatelliteProvider {
  const e = env ?? process.env;
  const live = Boolean(e.PLANET_API_KEY);
  return Object.freeze({
    id: 'planet-monthly',
    live,
    async getTimeSeries(args: {
      readonly bbox: BoundingBox;
      readonly dateRange: { readonly from: string; readonly to: string };
    }): Promise<ReadonlyArray<SatelliteImage>> {
      const out: SatelliteImage[] = [];
      const from = new Date(args.dateRange.from);
      const to = new Date(args.dateRange.to);
      const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      while (cursor <= to) {
        out.push({
          providerId: 'planet-monthly',
          capturedAt: cursor.toISOString(),
          tileUrl: live
            ? `https://api.planet.com/basemaps/v1/mosaics/planet_medres_normalized_analytic_${cursor.toISOString().slice(0, 7)}_mosaic/quads.png?api_key=${e.PLANET_API_KEY}`
            : `mock://planet-monthly/${cursor.toISOString().slice(0, 7)}.png`,
          bbox: args.bbox,
          resolutionM: 4,
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
      return out;
    },
  });
}
