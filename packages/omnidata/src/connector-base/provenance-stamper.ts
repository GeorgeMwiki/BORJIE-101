/**
 * Provenance stamper — wraps a raw upstream record into a canonical
 * `OmnidataIngestedItem` envelope, applies the boundary PII redactor,
 * stamps the audit hash, and (optionally) attaches the consent record.
 *
 * Pure factory. All ports (PII redactor, audit chain, clock, uuid)
 * are injectable.
 */

import type {
  OmnidataIngestedItem,
  OmnidataSourceKind,
  PIIRedactor,
  AuditChainPort,
  ClockPort,
  UuidPort,
} from '../types.js';

export interface ProvenanceStamperDeps {
  readonly redactor: PIIRedactor;
  readonly audit: AuditChainPort;
  readonly clock: ClockPort;
  readonly uuid: UuidPort;
}

export interface StampParams<TPayload> {
  readonly tenantId: string;
  readonly connectorId: string;
  readonly sourceKind: OmnidataSourceKind;
  readonly sourceRecordId: string;
  readonly payload: TPayload;
  readonly consentRecordId: string | null;
}

export interface ProvenanceStamper {
  readonly stamp: <TPayload>(p: StampParams<TPayload>) => Promise<OmnidataIngestedItem<TPayload>>;
}

export function createProvenanceStamper(deps: ProvenanceStamperDeps): ProvenanceStamper {
  return {
    async stamp<TPayload>(p: StampParams<TPayload>): Promise<OmnidataIngestedItem<TPayload>> {
      const { redacted, redactedFields } = deps.redactor.redact(p.payload);
      const id = deps.uuid.v4();
      const retrieved_at = deps.clock.nowIso();
      const { hash } = await deps.audit.append({
        tenantId: p.tenantId,
        action: 'omnidata.ingest',
        resourceId: `${p.connectorId}:${p.sourceRecordId}`,
        metadata: {
          source_kind: p.sourceKind,
          retrieved_at,
          redaction_applied: redactedFields,
          consent_record_id: p.consentRecordId,
        },
      });
      return {
        id,
        tenant_id: p.tenantId,
        connector_id: p.connectorId,
        source_kind: p.sourceKind,
        source_record_id: p.sourceRecordId,
        retrieved_at,
        payload: redacted,
        redaction_applied: redactedFields,
        consent_record_id: p.consentRecordId,
        audit_hash: hash,
      };
    },
  };
}
