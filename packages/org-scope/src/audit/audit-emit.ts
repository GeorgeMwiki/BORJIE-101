/**
 * Audit emission helpers (Wave 18X §10).
 *
 * Org-scope mutations are themselves audit-worthy events:
 *   - granting / revoking a `UserScopeBinding`
 *   - creating / renaming / removing an `OrgUnit`
 *   - upserting a `TerminologyOverride`
 *
 * Each of these flows through the canonical `@borjie/audit-hash-chain`
 * primitive so the platform's tamper-evident ledger stays sealed. This
 * module exports thin helpers that shape the audit payload — actual
 * persistence is the caller's responsibility (the audit-events table
 * lives in `@borjie/database`).
 */

import {
  chainHash,
  GENESIS_HASH,
  type AuditPayload,
  type ChainEntry,
} from '@borjie/audit-hash-chain';

export type OrgScopeAuditEventKind =
  | 'binding.granted'
  | 'binding.revoked'
  | 'org_unit.created'
  | 'org_unit.renamed'
  | 'org_unit.archived'
  | 'terminology.override.upserted'
  | 'terminology.override.removed';

export interface OrgScopeAuditEventInput {
  readonly tenantId: string;
  readonly kind: OrgScopeAuditEventKind;
  readonly actorUserId: string;
  readonly subjectId: string;
  readonly orgUnitId: string | null;
  readonly details: Record<string, unknown>;
  readonly occurredAt: string;
  readonly previousHash?: string;
  readonly previousIndex?: number;
}

export interface OrgScopeAuditEntry {
  readonly entry: ChainEntry;
  readonly canonical: AuditPayload;
}

/**
 * Build a hash-chained audit entry for an org-scope mutation. The
 * caller then writes the returned `entry` into the audit-events
 * Postgres table. Pure — does not perform I/O.
 */
export function buildOrgScopeAuditEntry(
  input: OrgScopeAuditEventInput,
): OrgScopeAuditEntry {
  const payload: AuditPayload = {
    tenantId: input.tenantId,
    kind: input.kind,
    actorUserId: input.actorUserId,
    subjectId: input.subjectId,
    orgUnitId: input.orgUnitId,
    details: input.details,
    occurredAt: input.occurredAt,
  };

  const prevHash = input.previousHash ?? GENESIS_HASH;
  const index = (input.previousIndex ?? -1) + 1;
  const rowHash = chainHash({ prev: prevHash, payload });
  const entry: ChainEntry = {
    index,
    prevHash,
    rowHash,
    payload,
    sealedAtIso: input.occurredAt,
  };
  return { entry, canonical: payload };
}
