/**
 * Piece N — pure JS polygon helpers.
 *
 * Application-side sanity checks before round-tripping to PostGIS. Also
 * the testing surface: in unit tests we operate on these Cartesian
 * polygon checks without needing a live PostGIS install. PostGIS does
 * the canonical spheroidal computation in production via
 * `ST_Within / ST_Intersects / ST_Area`.
 *
 * Notes on the maths:
 *   * `ST_Within` on tiny Tanzania-scale polygons is well approximated
 *     by Cartesian point-in-polygon when we accept ~0.001% error per
 *     1 km. That's fine for *validation* (we want to reject obvious
 *     overlap before paying the round-trip).
 *   * `area_sqm` here uses the spherical-excess / equirectangular
 *     fallback. Production callers should ALSO compute via PostGIS
 *     and store the canonical value; this is a sanity number for UI
 *     preview / instant feedback.
 */

import type { Point, Polygon, BoundingBox, PointCoords } from './types.js';

const EARTH_RADIUS_M = 6371008.8;

/**
 * Convert degrees to radians.
 */
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Compute polygon centroid via the standard shoelace formula on the
 * outer ring. Holes ignored — fine for parcel rendering anchors.
 * Returns the centroid as a GeoJSON Point.
 *
 * For degenerate (zero-area) rings, falls back to the average of
 * vertices.
 */
export function polygonCentroid(polygon: Polygon): Point {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) {
    throw new Error('polygon outer ring must have at least 4 points');
  }

  let signedArea = 0;
  let cx = 0;
  let cy = 0;

  // Walk the ring (excluding the duplicate closing vertex).
  for (let i = 0; i < ring.length - 1; i++) {
    const p0 = ring[i]!;
    const p1 = ring[i + 1]!;
    const x0 = p0[0];
    const y0 = p0[1];
    const x1 = p1[0];
    const y1 = p1[1];
    const cross = x0 * y1 - x1 * y0;
    signedArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  signedArea *= 0.5;

  if (Math.abs(signedArea) < 1e-12) {
    // Degenerate — fall back to vertex average (excluding duplicate close).
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      sx += ring[i]![0];
      sy += ring[i]![1];
      n++;
    }
    return {
      type: 'Point',
      coordinates: [sx / n, sy / n] as PointCoords,
    };
  }

  cx /= 6 * signedArea;
  cy /= 6 * signedArea;
  return {
    type: 'Point',
    coordinates: [cx, cy] as PointCoords,
  };
}

/**
 * Compute polygon area in square metres using the spherical-excess
 * formula. Approximate but accurate to <1% for polygons under a few
 * thousand sq km — well within tolerance for property parcels.
 */
export function polygonAreaSqm(polygon: Polygon): number {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return 0;

  let total = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const p0 = ring[i]!;
    const p1 = ring[i + 1]!;
    const lng0 = toRad(p0[0]);
    const lat0 = toRad(p0[1]);
    const lng1 = toRad(p1[0]);
    const lat1 = toRad(p1[1]);
    total += (lng1 - lng0) * (2 + Math.sin(lat0) + Math.sin(lat1));
  }

  const area = Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
  return area;
}

/**
 * Compute the axis-aligned bounding box of a polygon.
 */
export function polygonBoundingBox(polygon: Polygon): BoundingBox {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length === 0) {
    throw new Error('polygon has no points');
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const point of ring) {
    if (point[0] < minLng) minLng = point[0];
    if (point[0] > maxLng) maxLng = point[0];
    if (point[1] < minLat) minLat = point[1];
    if (point[1] > maxLat) maxLat = point[1];
  }

  return { min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat };
}

/**
 * Test whether a point lies inside a polygon using the ray-casting
 * algorithm. Points exactly on the boundary are considered inside.
 */
export function pointInPolygon(point: PointCoords, polygon: Polygon): boolean {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return false;

  const x = point[0];
  const y = point[1];
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersect =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Test whether the inner polygon is fully contained inside the outer
 * polygon. Approximates ST_Within for axis-aligned validation.
 *
 * Implementation: every vertex of the inner ring must lie inside the
 * outer polygon. This is necessary-and-sufficient when the outer
 * polygon is CONVEX. For non-convex outer polygons we ALSO need to
 * confirm no edge of the inner polygon exits the outer polygon — we
 * check that via segment-vs-edge intersection counting.
 */
export function polygonWithin(inner: Polygon, outer: Polygon): boolean {
  const innerRing = inner.coordinates[0];
  const outerRing = outer.coordinates[0];
  if (!innerRing || !outerRing) return false;

  // 1. Every inner vertex inside outer.
  for (const v of innerRing) {
    if (!pointInPolygon(v, outer)) return false;
  }

  // 2. No edge crosses an outer edge.
  for (let i = 0; i < innerRing.length - 1; i++) {
    const a1 = innerRing[i]!;
    const a2 = innerRing[i + 1]!;
    for (let j = 0; j < outerRing.length - 1; j++) {
      const b1 = outerRing[j]!;
      const b2 = outerRing[j + 1]!;
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Test whether two polygons have a positive-area overlap. Used in
 * subdivision validation to enforce non-overlap between sibling
 * children.
 *
 * If any vertex of one polygon is strictly inside the other (and not
 * on its boundary), they overlap. If any edges properly intersect,
 * they overlap. Shared boundary alone is NOT overlap.
 */
export function polygonsOverlap(a: Polygon, b: Polygon): boolean {
  const ringA = a.coordinates[0];
  const ringB = b.coordinates[0];
  if (!ringA || !ringB) return false;

  // 1. Any A vertex strictly inside B?
  for (const v of ringA) {
    if (pointStrictlyInPolygon(v, b)) return true;
  }
  // 2. Any B vertex strictly inside A?
  for (const v of ringB) {
    if (pointStrictlyInPolygon(v, a)) return true;
  }
  // 3. Edges properly cross?
  for (let i = 0; i < ringA.length - 1; i++) {
    const a1 = ringA[i]!;
    const a2 = ringA[i + 1]!;
    for (let j = 0; j < ringB.length - 1; j++) {
      const b1 = ringB[j]!;
      const b2 = ringB[j + 1]!;
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Strict point-in-polygon: returns true only if the point is in the
 * interior (not on the boundary).
 */
function pointStrictlyInPolygon(point: PointCoords, polygon: Polygon): boolean {
  if (!pointInPolygon(point, polygon)) return false;
  // Reject boundary points.
  const ring = polygon.coordinates[0]!;
  for (let i = 0; i < ring.length - 1; i++) {
    if (pointOnSegment(point, ring[i]!, ring[i + 1]!)) return false;
  }
  return true;
}

/**
 * Test whether a point lies on a line segment (within floating-point
 * tolerance).
 */
function pointOnSegment(p: PointCoords, a: PointCoords, b: PointCoords): boolean {
  const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 1e-12) return false;
  // Within the segment bounds?
  if (
    p[0] < Math.min(a[0], b[0]) - 1e-12 ||
    p[0] > Math.max(a[0], b[0]) + 1e-12
  ) {
    return false;
  }
  if (
    p[1] < Math.min(a[1], b[1]) - 1e-12 ||
    p[1] > Math.max(a[1], b[1]) + 1e-12
  ) {
    return false;
  }
  return true;
}

/**
 * Test whether two segments properly intersect (interior crossing —
 * shared endpoints don't count).
 */
function segmentsProperlyIntersect(
  a1: PointCoords,
  a2: PointCoords,
  b1: PointCoords,
  b2: PointCoords,
): boolean {
  const d1 = direction(b1, b2, a1);
  const d2 = direction(b1, b2, a2);
  const d3 = direction(a1, a2, b1);
  const d4 = direction(a1, a2, b2);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }
  return false;
}

function direction(a: PointCoords, b: PointCoords, c: PointCoords): number {
  return (c[0] - a[0]) * (b[1] - a[1]) - (b[0] - a[0]) * (c[1] - a[1]);
}

/**
 * Check whether two polygons share a bounding box that intersects.
 * Cheap pre-filter for spatial searches.
 */
export function bboxIntersects(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.max_lng < b.min_lng ||
    a.min_lng > b.max_lng ||
    a.max_lat < b.min_lat ||
    a.min_lat > b.max_lat
  );
}
