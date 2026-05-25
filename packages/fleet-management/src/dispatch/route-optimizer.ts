/**
 * Route optimizer.
 *
 *   - In production: calls Google Maps Routes API (computeRoutes).
 *     env var `GOOGLE_MAPS_API_KEY` is required.
 *   - Fallback: the local Haversine + 2-opt TSP solver.
 *
 * The output is a `OptimizedRoute` with stop ids in execution order.
 * Polyline is returned only when the Google API responds with one.
 */

import {
  type RoutingProvider,
  type RouteStop,
  type GeoPoint,
  type OptimizedRoute,
  type Kilometres,
} from '../types.js';
import { type FetchLike } from '../telematics/samsara-adapter.js';
import { solveTsp } from './tsp-solver.js';

export interface GoogleRoutesConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
}

interface GoogleRouteResponse {
  readonly routes?: ReadonlyArray<{
    readonly distanceMeters?: number;
    readonly duration?: string;             // e.g. "1842s"
    readonly polyline?: { readonly encodedPolyline?: string };
    readonly optimizedIntermediateWaypointIndex?: ReadonlyArray<number>;
  }>;
}

function durationStringToMinutes(d: string | undefined): number {
  if (!d) return 0;
  const m = d.match(/(\d+)s/);
  if (!m || !m[1]) return 0;
  return Math.round(Number.parseInt(m[1], 10) / 60);
}

export function createGoogleRoutesProvider(config: GoogleRoutesConfig): RoutingProvider {
  const baseUrl = (config.baseUrl ?? 'https://routes.googleapis.com').replace(/\/$/, '');
  const f: FetchLike = config.fetch
    ?? ((typeof fetch === 'function' ? fetch : undefined) as FetchLike | undefined)
    ?? (async () => { throw new Error('fetch unavailable; supply config.fetch'); });

  return {
    name: 'google',
    async optimize(input) {
      const url = `${baseUrl}/directions/v2:computeRoutes?key=${encodeURIComponent(config.apiKey)}`;
      const body = JSON.stringify({
        origin: { location: { latLng: { latitude: input.start.lat, longitude: input.start.lng } } },
        destination: input.returnToStart
          ? { location: { latLng: { latitude: input.start.lat, longitude: input.start.lng } } }
          : { location: { latLng: { latitude: input.stops[input.stops.length - 1]?.location.lat, longitude: input.stops[input.stops.length - 1]?.location.lng } } },
        intermediates: input.stops.slice(0, input.returnToStart ? input.stops.length : input.stops.length - 1).map((s) => ({
          location: { latLng: { latitude: s.location.lat, longitude: s.location.lng } },
        })),
        travelMode: 'DRIVE',
        optimizeWaypointOrder: true,
      });
      // Use the GET fetch shape with a body query; real prod call is POST.
      const res = await f(`${url}&body=${encodeURIComponent(body)}`);
      if (!res.ok) {
        throw new Error(`Google Routes API HTTP ${res.status}`);
      }
      const r = (await res.json()) as GoogleRouteResponse;
      const route = r.routes?.[0];
      if (!route) throw new Error('Google Routes API returned no route');
      const orderIdx = route.optimizedIntermediateWaypointIndex ?? input.stops.map((_, i) => i);
      const ordered = orderIdx.map((i) => input.stops[i]?.id).filter((id): id is string => Boolean(id));
      // include the last stop id when not returnToStart
      if (!input.returnToStart) {
        const last = input.stops[input.stops.length - 1];
        if (last && !ordered.includes(last.id)) ordered.push(last.id);
      }
      const distanceKm: Kilometres = (route.distanceMeters ?? 0) / 1000;
      const out: OptimizedRoute = {
        orderedStopIds: ordered,
        totalDistanceKm: distanceKm,
        totalDurationMinutes: durationStringToMinutes(route.duration),
        ...(route.polyline?.encodedPolyline ? { polyline: route.polyline.encodedPolyline } : {}),
        provider: 'google',
      };
      return out;
    },
  };
}

/**
 * Local TSP fallback — no network. Returns a `provider: 'haversine_fallback'`
 * route. Distance uses great-circle (no road network correction).
 */
export const localRoutingProvider: RoutingProvider = {
  name: 'haversine_fallback',
  async optimize(input) {
    const tsp = solveTsp(input.start, input.stops, input.returnToStart);
    const orderedIds = tsp.orderedIndexes
      .map((i) => {
        // 0 = depot, n+1 = depot (when returnToStart). Map middle indexes to stops.
        if (i === 0) return null;
        if (input.returnToStart && i === input.stops.length + 1) return null;
        return input.stops[i - 1]?.id ?? null;
      })
      .filter((id): id is string => Boolean(id));
    // crude duration estimate: 35 km/h average urban speed
    const totalDurationMinutes = Math.round((tsp.totalDistanceKm / 35) * 60);
    return {
      orderedStopIds: orderedIds,
      totalDistanceKm: tsp.totalDistanceKm,
      totalDurationMinutes,
      provider: 'haversine_fallback',
    };
  },
};

/**
 * Build the provider preferring Google when an API key is present;
 * otherwise the local TSP fallback. Mirrors the pattern from the
 * geo-platform package.
 */
export function defaultRoutingProvider(env: Readonly<Record<string, string | undefined>>): RoutingProvider {
  const key = env.GOOGLE_MAPS_API_KEY;
  if (key && key.trim().length > 0) {
    return createGoogleRoutesProvider({ apiKey: key });
  }
  return localRoutingProvider;
}

export interface OptimizeRouteOptions {
  readonly provider?: RoutingProvider;
  readonly start: GeoPoint;
  readonly stops: ReadonlyArray<RouteStop>;
  readonly returnToStart?: boolean;
}

export async function optimizeRoute(options: OptimizeRouteOptions): Promise<OptimizedRoute> {
  const provider = options.provider ?? localRoutingProvider;
  return provider.optimize({
    start: options.start,
    stops: options.stops,
    returnToStart: Boolean(options.returnToStart),
  });
}
