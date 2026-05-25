/**
 * Kenya compliance adapter — Ministry of Lands & Physical Planning.
 *
 * Production wires to NLIMS (National Land Information Management
 * System) — Ardhisasa.
 */

import type {
  FloodRiskBand,
  GeoJsonPoint,
  ParcelId,
  ZoningClass,
} from '../../types.js';

export const KE_AUTHORITY = 'Ministry of Lands & Physical Planning';

export function classifyKeZoning(point: GeoJsonPoint): ZoningClass {
  const [lng, lat] = point.coordinates;
  // Nairobi CBD ~ -1.28, 36.82
  if (lat > -1.32 && lat < -1.24 && lng > 36.78 && lng < 36.86) {
    return 'commercial';
  }
  // Mombasa Old Town ~ -4.05, 39.66
  if (lat > -4.08 && lat < -4.02 && lng > 39.63 && lng < 39.69) {
    return 'mixed_use';
  }
  // Tea-growing highlands (Kericho, Limuru)
  if (lat > -1.0 && lat < 1.0 && lng > 34.5 && lng < 36.0) {
    return 'agricultural';
  }
  return 'residential';
}

export function keFloodRisk(point: GeoJsonPoint): FloodRiskBand {
  const [lng, lat] = point.coordinates;
  // Tana River basin
  if (lat > -2.0 && lat < -0.5 && lng > 39.5 && lng < 40.5) return 'high';
  // Nairobi River corridor
  if (lat > -1.30 && lat < -1.26 && lng > 36.80 && lng < 36.86) return 'moderate';
  return 'low';
}

export function keLegalTitleStatus(parcelId: ParcelId): 'clean' | 'pending' | 'disputed' | 'unknown' {
  if (parcelId.startsWith('k-dispute')) return 'disputed';
  if (parcelId.startsWith('k-pending')) return 'pending';
  return 'clean';
}
