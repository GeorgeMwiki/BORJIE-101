'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequestOrFallback } from '@/lib/api-client';
import { MAP_FEATURES, type MapFeature } from '@/lib/mocks/portfolio-map';

export const portfolioMapKeys = {
  all: ['portfolio-map'] as const,
};

/**
 * GeoJSON portfolio roll-up.
 *
 * Live endpoint: GET /api/v1/mining/portfolio-map
 * (services/api-gateway/src/routes/mining/portfolio-map.hono.ts). The
 * gateway returns a FeatureCollection; the front-end works against
 * the bundled `MapFeature[]` shape. We adapt the FeatureCollection if
 * present, otherwise pass through whatever the live route returned.
 */
interface FeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: ReadonlyArray<unknown>;
}

interface PortfolioMapResult {
  readonly features: ReadonlyArray<MapFeature>;
  readonly raw: unknown;
}

function adaptFeatureCollection(raw: unknown): ReadonlyArray<MapFeature> {
  if (!raw || typeof raw !== 'object') return [];
  const collection = raw as FeatureCollection;
  if (!Array.isArray(collection.features)) return [];
  const out: MapFeature[] = [];
  for (const feature of collection.features) {
    if (!feature || typeof feature !== 'object') continue;
    const f = feature as {
      id?: string;
      properties?: Record<string, string | number>;
      geometry?: {
        type?: string;
        coordinates?: number[] | number[][] | number[][][];
      };
    };
    const props = f.properties ?? {};
    const kind =
      typeof props.kind === 'string'
        ? (props.kind as MapFeature['kind'])
        : 'site';
    const id = f.id ?? (typeof props.id === 'string' ? props.id : `feat_${out.length}`);
    const name = typeof props.name === 'string' ? props.name : String(id);
    const geometry = {
      type:
        f.geometry?.type === 'Polygon' || f.geometry?.type === 'LineString'
          ? (f.geometry.type as MapFeature['geometry']['type'])
          : 'Point',
      coordinates:
        (f.geometry?.coordinates as MapFeature['geometry']['coordinates']) ?? [0, 0],
    };
    out.push({
      id: String(id),
      kind,
      name,
      geometry,
      properties: props,
    });
  }
  return out;
}

export function usePortfolioMap() {
  return useQuery({
    queryKey: portfolioMapKeys.all,
    queryFn: async ({ signal }): Promise<PortfolioMapResult> => {
      const raw = await apiRequestOrFallback<unknown>(
        '/api/v1/mining/portfolio-map',
        { type: 'FeatureCollection', features: [] },
        { signal },
      );
      const live = adaptFeatureCollection(raw);
      // If the gateway returned no features, fall back to the bundled
      // demo set so the map never looks empty in dev / offline.
      const features = live.length > 0 ? live : MAP_FEATURES;
      return { features, raw };
    },
    staleTime: 5 * 60_000,
  });
}
