/**
 * Uganda compliance adapter — Uganda Land Commission + MLHUD.
 */

import type {
  FloodRiskBand,
  GeoJsonPoint,
  ParcelId,
  ZoningClass,
} from '../../types.js';

export const UG_AUTHORITY = 'Uganda Land Commission';

export function classifyUgZoning(point: GeoJsonPoint): ZoningClass {
  const [lng, lat] = point.coordinates;
  // Kampala CBD ~ 0.31, 32.58
  if (lat > 0.27 && lat < 0.35 && lng > 32.54 && lng < 32.62) {
    return 'commercial';
  }
  // Lake Victoria shoreline
  if (lat < 0.5 && lng > 32.0 && lng < 33.5) {
    return 'mixed_use';
  }
  return 'agricultural';
}

export function ugFloodRisk(point: GeoJsonPoint): FloodRiskBand {
  const [lng, lat] = point.coordinates;
  // Lake Kyoga basin
  if (lat > 1.0 && lat < 2.0 && lng > 32.0 && lng < 33.5) return 'high';
  return 'low';
}

export function ugLegalTitleStatus(parcelId: ParcelId): 'clean' | 'pending' | 'disputed' | 'unknown' {
  if (parcelId.startsWith('u-dispute')) return 'disputed';
  if (parcelId.startsWith('u-pending')) return 'pending';
  return 'clean';
}
