/**
 * District resolver — the entry point referenced by
 * Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md §B.4.
 *
 * Pure function:
 *
 *   resolveCustomerDistrict(customer, candidate_org_units)
 *     → CustomerDistrictAssignment
 *
 * No I/O. Persistence and notification fires are the caller's job —
 * this function is replayable and trivially testable.
 */

import { buildAuditLink } from '../audit/audit-chain-link.js';
import { pointInPolygon } from '../geo/polygon-contains.js';
import {
  administrativeCodeMatches,
  postalCodeMatches,
} from '../geo/postal-code-mapper.js';
import { haversineKm } from '../geo/haversine.js';
import type {
  CustomerDistrictAssignment,
  CustomerLocation,
  OrgUnitServiceArea,
} from '../types.js';
import { pickClosest, scoreCandidates } from './proximity-scorer.js';

export interface ResolveOptions {
  /** ISO 8601 wall-clock for `assigned_at`; defaults to `new Date().toISOString()`. */
  readonly nowIso?: string;
  /** Previous audit row hash (for chain continuation). */
  readonly previousAuditHash?: string;
}

export function resolveCustomerDistrict(
  customer: CustomerLocation,
  candidateOrgUnits: ReadonlyArray<OrgUnitServiceArea>,
  options: ResolveOptions = {},
): CustomerDistrictAssignment {
  const assignedAt = options.nowIso ?? new Date().toISOString();

  // 1. Filter to areas whose service_area includes the customer.
  const matches = candidateOrgUnits.filter((area) =>
    areaIncludesCustomer(area, customer),
  );

  if (matches.length === 0) {
    return finalize({
      customer,
      assignment_kind: 'manual_unassigned',
      assigned_org_unit_id: null,
      reasoning: 'no district service_area includes customer location',
      assignedAt,
      ...(options.previousAuditHash !== undefined
        ? { previousAuditHash: options.previousAuditHash }
        : {}),
    });
  }

  // 2. Score + pick closest.
  const scored = scoreCandidates(customer, matches);
  const best = pickClosest(scored);
  if (!best) {
    return finalize({
      customer,
      assignment_kind: 'manual_unassigned',
      assigned_org_unit_id: null,
      reasoning: 'scorer returned no candidate (defensive fallback)',
      assignedAt,
      ...(options.previousAuditHash !== undefined
        ? { previousAuditHash: options.previousAuditHash }
        : {}),
    });
  }

  const reasoning =
    best.distance_km !== undefined
      ? `closest district: ${best.area.org_unit_id} @ ${best.distance_km.toFixed(2)}km`
      : `priority-selected district: ${best.area.org_unit_id} (no measurable distance)`;

  return finalize({
    customer,
    assignment_kind: 'auto_geo',
    assigned_org_unit_id: best.area.org_unit_id,
    reasoning,
    ...(best.distance_km !== undefined ? { distance_km: best.distance_km } : {}),
    assignedAt,
    ...(options.previousAuditHash !== undefined
      ? { previousAuditHash: options.previousAuditHash }
      : {}),
  });
}

function areaIncludesCustomer(
  area: OrgUnitServiceArea,
  customer: CustomerLocation,
): boolean {
  // 1. Polygon
  if (area.polygon && customer.coordinates) {
    if (pointInPolygon(customer.coordinates, area.polygon)) return true;
  }
  // 2. Station + radius
  if (
    area.station_coords &&
    area.station_radius_km !== undefined &&
    customer.coordinates
  ) {
    const d = haversineKm(customer.coordinates, area.station_coords);
    if (d <= area.station_radius_km) return true;
  }
  // 3. Postal codes
  if (postalCodeMatches(customer.postal_code, area.postal_codes)) return true;
  // 4. Administrative codes
  if (
    administrativeCodeMatches(customer.administrative_code, area.administrative_codes)
  ) {
    return true;
  }
  return false;
}

interface FinalizeInput {
  readonly customer: CustomerLocation;
  readonly assignment_kind: CustomerDistrictAssignment['assignment_kind'];
  readonly assigned_org_unit_id: string | null;
  readonly reasoning: string;
  readonly distance_km?: number;
  readonly assignedAt: string;
  readonly previousAuditHash?: string;
}

function finalize(input: FinalizeInput): CustomerDistrictAssignment {
  const payload = {
    kind: 'customer_district_assignment',
    customer_id: input.customer.customer_id,
    tenant_id: input.customer.tenant_id,
    assigned_org_unit_id: input.assigned_org_unit_id,
    assignment_kind: input.assignment_kind,
    distance_km: input.distance_km ?? null,
    reasoning: input.reasoning,
    assigned_at: input.assignedAt,
  } as const;

  const link = buildAuditLink({
    payload,
    ...(input.previousAuditHash !== undefined
      ? { previousHash: input.previousAuditHash }
      : {}),
    sealedAtIso: input.assignedAt,
  });

  return {
    customer_id: input.customer.customer_id,
    tenant_id: input.customer.tenant_id,
    assigned_org_unit_id: input.assigned_org_unit_id,
    assignment_kind: input.assignment_kind,
    ...(input.distance_km !== undefined ? { distance_km: input.distance_km } : {}),
    reasoning: input.reasoning,
    assigned_at: input.assignedAt,
    audit_hash: link.rowHash,
  };
}
