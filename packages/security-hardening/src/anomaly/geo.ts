/**
 * Geographic helpers used by the anomaly detector.
 *
 * Haversine for great-circle distance — accurate enough at the
 * country/region scale we need for impossible-travel detection
 * (we don't need centimetre precision; we need "is this 900 km/h
 * plausible?" precision).
 */

import type { GeoLocation } from '../types.js';

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(a: GeoLocation, b: GeoLocation): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_KM * c;
}

/**
 * Compute implied speed in km/h between two timed locations. Returns
 * `Infinity` when `deltaMs <= 0` (clock skew / duplicate timestamps).
 */
export function impliedKmPerHour(
  fromAt: number,
  fromLoc: GeoLocation,
  toAt: number,
  toLoc: GeoLocation,
): number {
  const deltaMs = toAt - fromAt;
  if (deltaMs <= 0) return Infinity;
  const km = haversineKm(fromLoc, toLoc);
  const hours = deltaMs / 1000 / 3600;
  return km / hours;
}
