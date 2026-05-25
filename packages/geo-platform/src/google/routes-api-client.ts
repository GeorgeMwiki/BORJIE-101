/**
 * Google Routes API client — real-time traffic-aware routing.
 *
 * Docs: https://developers.google.com/maps/documentation/routes
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §1.3.
 *
 * Endpoint:
 *   POST https://routes.googleapis.com/directions/v2:computeRoutes
 *
 * The field mask header is mandatory; we request only what we need
 * to keep the bill down.
 */

import type {
  ClientCallOptions,
  GeoResult,
  RouteSummary,
  RoutesComputeInput,
} from '../types.js';
import { asError, fetchJson, missingKeyError, readApiKey, withKey } from './http.js';

const BASE_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const FIELD_MASK = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.staticDuration',
  'routes.polyline.encodedPolyline',
].join(',');

interface UpstreamRoute {
  readonly distanceMeters?: number;
  readonly duration?: string; // e.g. "1234s"
  readonly staticDuration?: string;
  readonly polyline?: { readonly encodedPolyline?: string };
}
interface UpstreamRoutesResponse {
  readonly routes?: readonly UpstreamRoute[];
}

/** Parse a Google duration string like `"123s"` to seconds. */
function parseDuration(s: string | undefined): number {
  if (!s) return 0;
  // strip trailing "s"
  const trimmed = s.endsWith('s') ? s.slice(0, -1) : s;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

function normalize(raw: UpstreamRoute): RouteSummary {
  return {
    distanceMeters: raw.distanceMeters ?? 0,
    durationSeconds: parseDuration(raw.duration),
    staticDurationSeconds: parseDuration(raw.staticDuration),
    encodedPolyline: raw.polyline?.encodedPolyline,
  };
}

export async function computeRoute(
  input: RoutesComputeInput,
  options: ClientCallOptions = {},
): Promise<GeoResult<RouteSummary>> {
  const key = readApiKey(options.apiKey);
  if (!key) return missingKeyError();

  const body: Record<string, unknown> = {
    origin: { location: { latLng: { latitude: input.origin.lat, longitude: input.origin.lng } } },
    destination: {
      location: { latLng: { latitude: input.destination.lat, longitude: input.destination.lng } },
    },
    travelMode: input.travelMode ?? 'DRIVE',
    routingPreference: input.routingPreference ?? 'TRAFFIC_AWARE',
  };
  if (input.departureTime) {
    body.departureTime = input.departureTime.toISOString();
  }

  const result = await fetchJson<UpstreamRoutesResponse>({
    url: withKey(BASE_URL, key),
    method: 'POST',
    body,
    headers: { 'x-goog-fieldmask': FIELD_MASK },
    options,
  });
  if (!result.ok) return asError(result);

  const first = result.data.routes?.[0];
  if (!first) {
    return {
      ok: false,
      error: { kind: 'not_found', message: 'No route found between origin and destination.' },
    };
  }
  return { ok: true, data: normalize(first) };
}
