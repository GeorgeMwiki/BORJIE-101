/**
 * Point-in-polygon test using the ray-casting algorithm.
 *
 * Pure function — no I/O. Handles polygons with holes per GeoJSON
 * convention (first ring is outer, subsequent rings are holes).
 *
 * Reference:
 *   - https://en.wikipedia.org/wiki/Point_in_polygon
 *   - https://wrf.ecse.rpi.edu/Research/Short_Notes/pnpoly.html (W. Randolph
 *     Franklin's classic implementation)
 */

import type { GeoJsonPolygon, GeoJsonPolygonRing, LatLng } from '../types.js';

/**
 * Returns true when `point` lies inside the polygon's outer ring AND
 * outside every hole. Points exactly on an edge are treated as inside;
 * this is the convention used by most geospatial libraries.
 */
export function pointInPolygon(point: LatLng, polygon: GeoJsonPolygon): boolean {
  const rings = polygon.coordinates;
  if (rings.length === 0) return false;

  const outerRing = rings[0];
  if (!outerRing) return false;
  if (!pointInRing(point, outerRing)) return false;

  // For each hole, if the point is inside the hole then the point is
  // NOT in the polygon.
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i];
    if (!hole) continue;
    if (pointInRing(point, hole)) return false;
  }
  return true;
}

/**
 * Ray-casting test on a single ring. The ring is a list of [lng, lat]
 * pairs per GeoJSON; we project to (x = lng, y = lat) and cast a
 * horizontal ray to the right.
 */
function pointInRing(point: LatLng, ring: GeoJsonPolygonRing): boolean {
  const x = point.lng;
  const y = point.lat;
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const [xi, yi] = a;
    const [xj, yj] = b;

    // Edge crosses the horizontal ray through (x, y) → toggle inside.
    const crosses = (yi > y) !== (yj > y);
    if (!crosses) continue;

    const denom = yj - yi;
    if (denom === 0) continue;
    const xIntersect = ((xj - xi) * (y - yi)) / denom + xi;
    if (x < xIntersect) {
      inside = !inside;
    }
  }
  return inside;
}
