/**
 * Tanzania compliance adapter — NLUPC (National Land Use Planning
 * Commission) overlay scaffold.
 *
 * The real implementation calls NLUPC + Ministry of Lands cadastral
 * APIs. Here we return deterministic stubs based on coarse
 * latitude/longitude binning so tests can assert per-jurisdiction
 * behavior without network access.
 */

import type {
  FloodRiskBand,
  GeoJsonPoint,
  ParcelId,
  ZoningClass,
} from '../../types.js';

export const TZ_AUTHORITY = 'NLUPC';

export function classifyTzZoning(point: GeoJsonPoint): ZoningClass {
  // Dar es Salaam CBD ~ -6.81, 39.28
  const [lng, lat] = point.coordinates;
  if (lat > -6.85 && lat < -6.75 && lng > 39.25 && lng < 39.35) {
    return 'commercial';
  }
  // Coastal strip
  if (lng > 39.0 && lat < -5.0) {
    return 'mixed_use';
  }
  // Northern highlands
  if (lat > -4.0) {
    return 'agricultural';
  }
  return 'residential';
}

export function tzFloodRisk(point: GeoJsonPoint): FloodRiskBand {
  // Jangwani / Msimbazi basin in Dar — historic flooding
  const [lng, lat] = point.coordinates;
  if (lat > -6.83 && lat < -6.79 && lng > 39.27 && lng < 39.30) {
    return 'high';
  }
  return 'low';
}

export function tzLegalTitleStatus(parcelId: ParcelId): 'clean' | 'pending' | 'disputed' | 'unknown' {
  // Stub: id starting with "t-dispute" -> disputed. Production wires to
  // Ministry of Lands' registry lookup.
  if (parcelId.startsWith('t-dispute')) return 'disputed';
  if (parcelId.startsWith('t-pending')) return 'pending';
  return 'clean';
}
