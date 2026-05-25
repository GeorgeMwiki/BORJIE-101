/**
 * Rwanda compliance adapter — Rwanda Land Management & Use Authority.
 *
 * Rwanda's land registry is among the most modern in EA (digital +
 * blockchain-anchored). Production wires to the RLMUA API.
 */

import type {
  FloodRiskBand,
  GeoJsonPoint,
  ParcelId,
  ZoningClass,
} from '../../types.js';

export const RW_AUTHORITY = 'Rwanda Land Management & Use Authority';

export function classifyRwZoning(point: GeoJsonPoint): ZoningClass {
  const [lng, lat] = point.coordinates;
  // Kigali CBD ~ -1.95, 30.06
  if (lat > -1.99 && lat < -1.91 && lng > 30.02 && lng < 30.10) {
    return 'commercial';
  }
  return 'agricultural';
}

export function rwFloodRisk(point: GeoJsonPoint): FloodRiskBand {
  const [lng, lat] = point.coordinates;
  // Akagera basin
  if (lat > -2.0 && lat < -1.0 && lng > 30.5 && lng < 31.0) return 'moderate';
  return 'low';
}

export function rwLegalTitleStatus(parcelId: ParcelId): 'clean' | 'pending' | 'disputed' | 'unknown' {
  if (parcelId.startsWith('r-dispute')) return 'disputed';
  if (parcelId.startsWith('r-pending')) return 'pending';
  return 'clean';
}
