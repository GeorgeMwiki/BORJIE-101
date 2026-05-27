/**
 * Proximity scoring — given a customer location and a set of areas the
 * customer already passes inclusion for, pick the closest one.
 *
 * Scoring rule (in order):
 *   1. If both customer and area have coordinates, use haversine distance.
 *      Smaller distance wins.
 *   2. If only the area has coords (customer is postal/admin-coded),
 *      distance is undefined; fall back to priority.
 *   3. On ties (distance equal or both undefined), highest area
 *      `priority` wins. Ties on priority broken by lexicographic
 *      `org_unit_id` for stability.
 */

import { haversineKm } from '../geo/haversine.js';
import type { CustomerLocation, OrgUnitServiceArea } from '../types.js';

export interface ScoredCandidate {
  readonly area: OrgUnitServiceArea;
  readonly distance_km?: number;
  readonly score_kind: 'distance' | 'priority';
}

export function scoreCandidates(
  customer: CustomerLocation,
  matches: ReadonlyArray<OrgUnitServiceArea>,
): ReadonlyArray<ScoredCandidate> {
  const scored: ScoredCandidate[] = [];
  for (const area of matches) {
    const distance = computeDistance(customer, area);
    scored.push({
      area,
      ...(distance !== undefined ? { distance_km: distance } : {}),
      score_kind: distance !== undefined ? 'distance' : 'priority',
    });
  }
  return scored;
}

export function pickClosest(
  scored: ReadonlyArray<ScoredCandidate>,
): ScoredCandidate | null {
  if (scored.length === 0) return null;
  let best = scored[0];
  if (!best) return null;

  for (let i = 1; i < scored.length; i++) {
    const next = scored[i];
    if (!next) continue;
    if (isBetter(next, best)) {
      best = next;
    }
  }
  return best;
}

function isBetter(a: ScoredCandidate, b: ScoredCandidate): boolean {
  const aDist = a.distance_km;
  const bDist = b.distance_km;
  if (aDist !== undefined && bDist !== undefined) {
    if (aDist < bDist) return true;
    if (aDist > bDist) return false;
    return tiebreakByPriority(a, b);
  }
  if (aDist !== undefined && bDist === undefined) {
    return true;
  }
  if (aDist === undefined && bDist !== undefined) {
    return false;
  }
  // Both undefined → pure priority.
  return tiebreakByPriority(a, b);
}

function tiebreakByPriority(a: ScoredCandidate, b: ScoredCandidate): boolean {
  if (a.area.priority > b.area.priority) return true;
  if (a.area.priority < b.area.priority) return false;
  // Stable order — lexicographic org_unit_id.
  return a.area.org_unit_id < b.area.org_unit_id;
}

function computeDistance(
  customer: CustomerLocation,
  area: OrgUnitServiceArea,
): number | undefined {
  const c = customer.coordinates;
  const s = area.station_coords;
  if (!c || !s) return undefined;
  return haversineKm(c, s);
}
