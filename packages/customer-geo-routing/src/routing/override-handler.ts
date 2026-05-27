/**
 * Override handler — produces `CustomerDistrictAssignment` rows for the
 * customer-initiated and admin-initiated override paths described in
 * Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md §B.5.
 *
 * Same audit-chain primitive as the auto-geo resolver. The caller is
 * responsible for marking the previous assignment `active = false` /
 * stamping `superseded_at` — this module only synthesises the new row.
 */

import { buildAuditLink } from '../audit/audit-chain-link.js';
import type { CustomerDistrictAssignment, CustomerLocation } from '../types.js';

export interface CustomerOverrideInput {
  readonly customer: CustomerLocation;
  readonly preferred_org_unit_id: string;
  readonly reason: string;
  readonly nowIso?: string;
  readonly previousAuditHash?: string;
}

export function applyCustomerOverride(
  input: CustomerOverrideInput,
): CustomerDistrictAssignment {
  return finalizeOverride({
    customer: input.customer,
    assigned_org_unit_id: input.preferred_org_unit_id,
    assignment_kind: 'customer_override',
    reasoning: `customer override: ${input.reason}`,
    ...(input.nowIso !== undefined ? { nowIso: input.nowIso } : {}),
    ...(input.previousAuditHash !== undefined
      ? { previousAuditHash: input.previousAuditHash }
      : {}),
  });
}

export interface AdminOverrideInput {
  readonly customer: CustomerLocation;
  readonly assigned_org_unit_id: string;
  readonly actor_user_id: string;
  readonly reason: string;
  readonly nowIso?: string;
  readonly previousAuditHash?: string;
}

export function applyAdminOverride(
  input: AdminOverrideInput,
): CustomerDistrictAssignment {
  return finalizeOverride({
    customer: input.customer,
    assigned_org_unit_id: input.assigned_org_unit_id,
    assignment_kind: 'admin_override',
    reasoning: `admin override by ${input.actor_user_id}: ${input.reason}`,
    ...(input.nowIso !== undefined ? { nowIso: input.nowIso } : {}),
    ...(input.previousAuditHash !== undefined
      ? { previousAuditHash: input.previousAuditHash }
      : {}),
  });
}

interface FinalizeOverrideInput {
  readonly customer: CustomerLocation;
  readonly assigned_org_unit_id: string;
  readonly assignment_kind: 'customer_override' | 'admin_override';
  readonly reasoning: string;
  readonly nowIso?: string;
  readonly previousAuditHash?: string;
}

function finalizeOverride(
  input: FinalizeOverrideInput,
): CustomerDistrictAssignment {
  const assignedAt = input.nowIso ?? new Date().toISOString();
  const payload = {
    kind: 'customer_district_assignment',
    customer_id: input.customer.customer_id,
    tenant_id: input.customer.tenant_id,
    assigned_org_unit_id: input.assigned_org_unit_id,
    assignment_kind: input.assignment_kind,
    reasoning: input.reasoning,
    assigned_at: assignedAt,
  } as const;
  const link = buildAuditLink({
    payload,
    ...(input.previousAuditHash !== undefined
      ? { previousHash: input.previousAuditHash }
      : {}),
    sealedAtIso: assignedAt,
  });
  return {
    customer_id: input.customer.customer_id,
    tenant_id: input.customer.tenant_id,
    assigned_org_unit_id: input.assigned_org_unit_id,
    assignment_kind: input.assignment_kind,
    reasoning: input.reasoning,
    assigned_at: assignedAt,
    audit_hash: link.rowHash,
  };
}
