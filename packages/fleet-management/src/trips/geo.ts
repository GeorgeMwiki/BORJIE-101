/**
 * Geo helpers — Haversine distance, polyline length, breadcrumb
 * smoothing. Pure functions, no I/O.
 */

import { type GeoPoint } from '../types.js';

const EARTH_RADIUS_KM = 6_371.0088;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two points (km). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const aTerm =
    sinDLat * sinDLat
    + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(aTerm), Math.sqrt(1 - aTerm));
  return EARTH_RADIUS_KM * c;
}

/** Polyline length — sums consecutive haversine segments. */
export function polylineLengthKm(points: ReadonlyArray<GeoPoint>): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineKm(points[i - 1]!, points[i]!);
  }
  return total;
}

/**
 * Drop breadcrumbs that are within `epsilonM` metres of the previous
 * kept point. Greatly reduces storage for noisy GPS without losing
 * meaningful turns.
 */
export function smoothBreadcrumbs(
  points: ReadonlyArray<GeoPoint>,
  epsilonM: number,
): ReadonlyArray<GeoPoint> {
  if (points.length <= 2) return points;
  const epsilonKm = epsilonM / 1000;
  const kept: GeoPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const last = kept[kept.length - 1]!;
    const here = points[i]!;
    if (haversineKm(last, here) >= epsilonKm) {
      kept.push(here);
    }
  }
  kept.push(points[points.length - 1]!);
  return kept;
}
