/**
 * Piece N — capture a land area.
 *
 * `captureLandArea` is the canonical entry point when a user walks the
 * boundary of a site (GPS walk), draws on a map, imports KML/GeoJSON,
 * or traces from satellite imagery. It:
 *
 *   1. Validates the boundary polygon shape (Zod + ring closure).
 *   2. Computes centroid + area_sqm via local maths (PostGIS computes
 *      the canonical area at write-time too; we precompute for
 *      instant UI feedback).
 *   3. Optionally reverse-geocodes for `region` / `ward` via an
 *      injectable resolver (no network call lives in this package).
 *   4. Persists via the port.
 */

import { z } from 'zod';

import { GeoParcelsError, LandAreaSchema, PolygonSchema } from './types.js';
import type {
  CaptureVia,
  LandArea,
  Polygon,
} from './types.js';
import { polygonAreaSqm, polygonCentroid } from './polygon-math.js';
import type { GeoParcelsPort } from './persistence-port.js';
import { logger } from './logger.js';

/**
 * Optional reverse-geocoder. Pure interface — no I/O inside this
 * package. Callers wire OpenStreetMap Nominatim / Google / etc.
 */
export interface ReverseGeocoder {
  resolve(args: {
    longitude: number;
    latitude: number;
  }): Promise<{
    jurisdiction?: string;
    region?: string;
    ward?: string;
  } | null>;
}

export interface CaptureLandAreaArgs {
  id: string;
  tenant_id: string;
  display_name: string;
  description?: string | null;
  boundary_polygon: Polygon;
  jurisdiction: string;
  region?: string | null;
  ward?: string | null;
  plot_number?: string | null;
  captured_via: CaptureVia;
  captured_by_user_id: string;
  core_entity_id?: string | null;
}

/**
 * Validate the boundary ring is closed (first == last point). Zod
 * already enforces min(4) points; closure is a separate semantic rule.
 */
function assertClosedRing(polygon: Polygon): void {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) {
    throw new GeoParcelsError(
      'INVALID_POLYGON',
      'polygon outer ring must have at least 4 points',
    );
  }
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new GeoParcelsError(
      'INVALID_POLYGON',
      'polygon outer ring is not closed (first point != last point)',
    );
  }
}

/**
 * Capture a land area. The reverseGeocoder is OPTIONAL; if absent, the
 * region/ward fall back to whatever was passed in args.
 */
export async function captureLandArea(
  port: GeoParcelsPort,
  args: CaptureLandAreaArgs,
  reverseGeocoder?: ReverseGeocoder,
): Promise<LandArea> {
  // 1. Validate the polygon shape.
  const polyResult = PolygonSchema.safeParse(args.boundary_polygon);
  if (!polyResult.success) {
    throw new GeoParcelsError(
      'INVALID_POLYGON',
      `boundary_polygon failed validation: ${polyResult.error.message}`,
    );
  }
  assertClosedRing(args.boundary_polygon);

  // 2. Compute centroid + area.
  const center_point = polygonCentroid(args.boundary_polygon);
  const area_sqm = polygonAreaSqm(args.boundary_polygon);

  // 3. Optionally reverse-geocode for region/ward.
  let region = args.region ?? null;
  let ward = args.ward ?? null;
  let jurisdiction = args.jurisdiction;

  if (reverseGeocoder && (!region || !ward)) {
    try {
      const lookup = await reverseGeocoder.resolve({
        longitude: center_point.coordinates[0],
        latitude: center_point.coordinates[1],
      });
      if (lookup) {
        if (!region && lookup.region) region = lookup.region;
        if (!ward && lookup.ward) ward = lookup.ward;
        if (lookup.jurisdiction) jurisdiction = lookup.jurisdiction;
      }
    } catch (err) {
      // Reverse-geocode failure is non-fatal — we logged what we have.
      // Application can re-attempt async.
      logger.warn('reverse-geocode lookup failed during captureLandArea', { value: err instanceof Error ? err.message : String(err) });
    }
  }

  // 4. Validate full row + persist.
  const row: LandArea = {
    id: args.id,
    tenant_id: args.tenant_id,
    core_entity_id: args.core_entity_id ?? null,
    display_name: args.display_name,
    description: args.description ?? null,
    boundary_polygon: args.boundary_polygon,
    center_point,
    area_sqm,
    jurisdiction,
    region,
    ward,
    plot_number: args.plot_number ?? null,
    captured_via: args.captured_via,
    captured_by_user_id: args.captured_by_user_id,
  };

  const rowResult = LandAreaSchema.safeParse(row);
  if (!rowResult.success) {
    throw new GeoParcelsError(
      'INVALID_LAND_AREA',
      `land_area failed validation: ${rowResult.error.message}`,
    );
  }

  return port.insertLandArea(row);
}

/**
 * Re-exported guard for symmetric use in tests/callers.
 */
export const CaptureLandAreaArgsSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  display_name: z.string().min(1),
  description: z.string().nullable().optional(),
  boundary_polygon: PolygonSchema,
  jurisdiction: z.string().length(2),
  region: z.string().nullable().optional(),
  ward: z.string().nullable().optional(),
  plot_number: z.string().nullable().optional(),
  captured_via: z.enum(['manual_draw', 'gps_walk', 'gis_import', 'satellite_trace']),
  captured_by_user_id: z.string().min(1),
  core_entity_id: z.string().nullable().optional(),
});
