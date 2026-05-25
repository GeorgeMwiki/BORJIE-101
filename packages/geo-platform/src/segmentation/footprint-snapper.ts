/**
 * Footprint snapper — given a click point and a candidate list of
 * reference buildings (Google Open Buildings, Overture, Microsoft,
 * OSM), pick the closest one within `radiusM`.
 *
 * Spec: `.audit/sota-2026-05-24/01-geo-platform.md` §4 / §5.1.
 *
 * Source priority (Africa-first):
 *   1. google_open_buildings   (best EA coverage)
 *   2. cadastral_authority     (when present)
 *   3. overture                (global, well-cleaned)
 *   4. microsoft_ml_footprints (US/EU/AU strong, EA growing)
 *   5. osm                     (sanity check / fallback)
 */

import type {
  FootprintSource,
  GeoJsonPoint,
  GeoJsonPolygon,
  Position,
  ReferenceBuilding,
  SnapResult,
} from '../types.js';

export const DEFAULT_SNAP_RADIUS_M = 25;

/** Source priority — lower number = higher priority. */
const SOURCE_PRIORITY: Record<FootprintSource, number> = {
  google_open_buildings: 1,
  cadastral_authority: 2,
  overture: 3,
  microsoft_ml_footprints: 4,
  osm: 5,
};

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

function haversineM(a: Position, b: Position): number {
  const lat1 = a[1] * DEG_TO_RAD;
  const lat2 = b[1] * DEG_TO_RAD;
  const dLat = (b[1] - a[1]) * DEG_TO_RAD;
  const dLon = (b[0] - a[0]) * DEG_TO_RAD;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function polygonCentroid(polygon: GeoJsonPolygon): Position {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const outer = polygon.coordinates[0] ?? [];
  for (const [lon, lat] of outer) {
    sx += lon;
    sy += lat;
    n++;
  }
  if (n === 0) return [0, 0];
  return [sx / n, sy / n];
}

function ensureCentroid(b: ReferenceBuilding): Position {
  if (b.centroid) return b.centroid.coordinates;
  return polygonCentroid(b.polygon);
}

export interface SnapInput {
  readonly point: GeoJsonPoint;
  readonly candidates: readonly ReferenceBuilding[];
  readonly radiusM?: number;
}

/**
 * Choose the closest candidate. Ties broken by source priority, then
 * higher source confidence. Returns `null` if nothing within radius.
 */
export function snapToBuilding(input: SnapInput): SnapResult | null {
  const radius = input.radiusM ?? DEFAULT_SNAP_RADIUS_M;
  const [lon, lat] = input.point.coordinates;
  let best: { result: SnapResult; priority: number; confidence: number } | null = null;
  for (const building of input.candidates) {
    const centroid = ensureCentroid(building);
    const distance = haversineM([lon, lat], centroid);
    if (distance > radius) continue;
    const priority = SOURCE_PRIORITY[building.source] ?? 99;
    const confidence = building.confidence ?? 0.5;
    if (
      best === null ||
      distance < best.result.distanceM ||
      (distance === best.result.distanceM && priority < best.priority) ||
      (distance === best.result.distanceM &&
        priority === best.priority &&
        confidence > best.confidence)
    ) {
      best = {
        result: { building, distanceM: distance, source: building.source },
        priority,
        confidence,
      };
    }
  }
  return best?.result ?? null;
}

/**
 * Rank ALL candidates within radius — useful when the UI wants to show
 * a "snap suggestions" list rather than auto-snap.
 */
export function rankCandidates(input: SnapInput): readonly SnapResult[] {
  const radius = input.radiusM ?? DEFAULT_SNAP_RADIUS_M;
  const [lon, lat] = input.point.coordinates;
  const rows: SnapResult[] = [];
  for (const building of input.candidates) {
    const centroid = ensureCentroid(building);
    const distance = haversineM([lon, lat], centroid);
    if (distance > radius) continue;
    rows.push({ building, distanceM: distance, source: building.source });
  }
  rows.sort((a, b) => {
    if (a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
    const pa = SOURCE_PRIORITY[a.source] ?? 99;
    const pb = SOURCE_PRIORITY[b.source] ?? 99;
    if (pa !== pb) return pa - pb;
    const ca = a.building.confidence ?? 0.5;
    const cb = b.building.confidence ?? 0.5;
    return cb - ca;
  });
  return rows;
}
