/**
 * Snap-to-building — find the nearest reference building footprint
 * (Overture / Google Open Buildings) within a tolerance of a query
 * point.
 *
 * The DB-side query uses `ST_DWithin` + `ST_Distance` on the GIST
 * index; this in-process helper is the parcel-service fallback / unit
 * test surface and the same shape we ship to the browser if we ever
 * inline a tiny pre-fetched footprint list.
 *
 * Spec: `.audit/litfin-sota-2026-05-23/17-spatial-parcel-engine.md`.
 */

import { centroid as polyCentroid, haversineDistanceM } from './geometry.js';
import type {
  GeoJsonPoint,
  GeoJsonPolygon,
  ReferenceBuilding,
  SnapResult,
} from './types.js';

/** Spec §6: default snap radius is 25 m (research report). */
export const DEFAULT_SNAP_RADIUS_M = 25;

/**
 * Find the nearest reference building footprint within `radiusM`.
 * Returns `null` if no candidate is within tolerance.
 *
 * Distance is measured between the query point and the candidate
 * footprint's centroid (good-enough proxy for tenant-scale buildings;
 * the DB layer uses true Hausdorff distance for production traffic).
 */
export function snapToNearestBuilding(
  point: GeoJsonPoint,
  candidates: readonly ReferenceBuilding[],
  radiusM: number = DEFAULT_SNAP_RADIUS_M,
): SnapResult | null {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return null;
  if (!candidates || candidates.length === 0) return null;

  let best: SnapResult | null = null;
  for (const candidate of candidates) {
    const distanceM = haversineDistanceM(
      point,
      polyCentroid(candidate.footprint),
    );
    if (distanceM > radiusM) continue;
    if (!best || distanceM < best.distanceM) {
      best = { building: candidate, distanceM };
    }
  }
  return best;
}

/** Convenience: build a `ReferenceBuilding` literal. */
export function refBuilding(
  id: string,
  source: 'overture' | 'google_open_buildings',
  footprint: GeoJsonPolygon,
): ReferenceBuilding {
  return { id, source, footprint };
}
