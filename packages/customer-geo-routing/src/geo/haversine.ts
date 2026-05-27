/**
 * Great-circle distance between two coordinates using the haversine
 * formula.
 *
 * Pure function — no I/O. Earth radius is the WGS84 mean
 * (6371.0088 km); the typical haversine literature uses 6371 km
 * exactly. Returning the WGS84 mean trims the error band slightly when
 * the points are far apart.
 *
 * Reference: https://en.wikipedia.org/wiki/Haversine_formula
 */

import type { LatLng } from '../types.js';

const EARTH_RADIUS_KM = 6371.0088;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Distance in kilometres between two lat/lng points. Returns 0 when
 * the points are identical. Never returns NaN — callers can rely on
 * a finite non-negative number.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const aVal =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  // clamp to [0, 1] before sqrt to defend against FP drift on very small
  // distances (Math.sqrt of a tiny negative is NaN).
  const clamped = Math.max(0, Math.min(1, aVal));
  const c = 2 * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));

  return EARTH_RADIUS_KM * c;
}
