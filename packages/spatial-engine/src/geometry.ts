/**
 * Geometry helpers — pure JS, no DOM, optional turf.js.
 *
 * Server-side area / boundary calculations for Muzima parcel polygons.
 * If `@turf/turf` is installed we delegate to it for speed + edge-case
 * coverage; otherwise we fall back to a spherical-excess area formula
 * (Karney 2013 — good enough for tenant-scale parcels at ±0.1 %).
 *
 * Spec: `.audit/litfin-sota-2026-05-23/17-spatial-parcel-engine.md`.
 */

import type {
  GeoJsonPoint,
  GeoJsonPolygon,
  GeoJsonMultiPolygon,
  Position,
  BoundingBox,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

const EARTH_RADIUS_M = 6_371_008.8; // mean radius (NIST)
const DEG_TO_RAD = Math.PI / 180;

// ============================================================================
// Optional turf delegation
// ============================================================================

type TurfArea = (geom: { type: string; coordinates: unknown }) => number;

let turfArea: TurfArea | null = null;
try {
  const turf = require('@turf/turf') as { area?: TurfArea };
  if (turf && typeof turf.area === 'function') {
    turfArea = turf.area;
  }
} catch {
  // turf not installed — fall back to local impl.
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Area of a Polygon or MultiPolygon in square metres.
 *
 * For polygons containing holes, holes are subtracted from the outer
 * ring (turf does this automatically). Always non-negative.
 */
export function areaSqm(geom: GeoJsonPolygon | GeoJsonMultiPolygon): number {
  if (turfArea) {
    // turf accepts GeoJson Geometry directly
    return Math.max(0, turfArea({ type: geom.type, coordinates: geom.coordinates }));
  }
  if (geom.type === 'Polygon') {
    return polygonAreaSqm(geom.coordinates);
  }
  let sum = 0;
  for (const poly of geom.coordinates) {
    sum += polygonAreaSqm(poly);
  }
  return sum;
}

/**
 * Centroid of the OUTER ring (no hole weighting). Good enough for
 * "label the parcel" use; not for mass-centred analytics.
 */
export function centroid(geom: GeoJsonPolygon | GeoJsonMultiPolygon): GeoJsonPoint {
  const outer = geom.type === 'Polygon'
    ? geom.coordinates[0]
    : geom.coordinates[0]?.[0];

  if (!outer || outer.length === 0) {
    return { type: 'Point', coordinates: [0, 0] };
  }

  let lonSum = 0;
  let latSum = 0;
  // closed ring → last point repeats first; skip it for the average.
  const n = outer.length - 1 > 0 ? outer.length - 1 : outer.length;
  for (let i = 0; i < n; i += 1) {
    const pt = outer[i];
    if (!pt) continue;
    lonSum += pt[0];
    latSum += pt[1];
  }
  return {
    type: 'Point',
    coordinates: [lonSum / n, latSum / n],
  };
}

/**
 * Tight bbox of any Polygon / MultiPolygon. Returns minLon/minLat/
 * maxLon/maxLat in WGS84 degrees.
 */
export function boundingBox(
  geom: GeoJsonPolygon | GeoJsonMultiPolygon,
): BoundingBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const rings = geom.type === 'Polygon'
    ? geom.coordinates
    : geom.coordinates.flat();

  for (const ring of rings) {
    for (const pt of ring) {
      if (!pt) continue;
      const lon = pt[0];
      const lat = pt[1];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }

  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Great-circle distance between two GeoJSON points, in metres.
 * Standard haversine; safe for the < 100 km distances we ever pass.
 */
export function haversineDistanceM(a: GeoJsonPoint, b: GeoJsonPoint): number {
  const [lon1, lat1] = a.coordinates;
  const [lon2, lat2] = b.coordinates;
  return haversineRaw(lon1, lat1, lon2, lat2);
}

export function haversineRaw(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const lat1r = lat1 * DEG_TO_RAD;
  const lat2r = lat2 * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1r) * Math.cos(lat2r);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

// ============================================================================
// Internal — spherical polygon area
// ============================================================================

function polygonAreaSqm(rings: readonly (readonly Position[])[]): number {
  if (!rings || rings.length === 0) return 0;
  const outer = rings[0];
  if (!outer) return 0;
  let area = Math.abs(ringAreaSqm(outer));
  for (let i = 1; i < rings.length; i += 1) {
    const hole = rings[i];
    if (!hole) continue;
    area -= Math.abs(ringAreaSqm(hole));
  }
  return Math.max(0, area);
}

/**
 * Spherical-excess ring area (Karney 2013, simplified). Returns the
 * SIGNED area in m^2 — positive for counter-clockwise rings in WGS84.
 */
function ringAreaSqm(ring: readonly Position[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n - 1; i += 1) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    if (!p1 || !p2) continue;
    total +=
      (p2[0] - p1[0]) * DEG_TO_RAD *
      (2 + Math.sin(p1[1] * DEG_TO_RAD) + Math.sin(p2[1] * DEG_TO_RAD));
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}
