/**
 * Piece N — attach evidence (title deeds, leases, photos) to a parcel.
 *
 * `document_id` is a SOFT pointer to the `documents` table (Piece K) —
 * if Piece K is present in the running deployment, the application
 * should resolve and attach the canonical document row first. If Piece
 * K isn't there yet, callers may supply only `storage_path` and a
 * structured `evidence_kind`.
 *
 * Every attach is logged via the activity chain.
 */

import { GeoParcelsError, ParcelEvidenceSchema } from './types.js';
import type {
  EvidenceKind,
  ParcelEvidence,
} from './types.js';
import type { GeoParcelsPort } from './persistence-port.js';
import { appendActivity } from './activity-log.js';

export interface AttachEvidenceArgs {
  id: string;
  tenant_id: string;
  parcel_id: string;
  evidence_kind: EvidenceKind;
  document_id?: string | null;
  trust_score?: number | null;
  storage_path?: string | null;
  public_visible?: boolean;
  verified_by_user_id?: string | null;
  verified_at?: Date | null;
  actor_user_id?: string;
  actor_persona_id?: string | null;
}

export async function attachEvidence(
  port: GeoParcelsPort,
  args: AttachEvidenceArgs,
): Promise<ParcelEvidence> {
  if (!args.document_id && !args.storage_path) {
    throw new GeoParcelsError(
      'NO_EVIDENCE_LOCATION',
      'attachEvidence requires either document_id or storage_path',
    );
  }

  const row: ParcelEvidence = {
    id: args.id,
    tenant_id: args.tenant_id,
    parcel_id: args.parcel_id,
    document_id: args.document_id ?? null,
    evidence_kind: args.evidence_kind,
    trust_score: args.trust_score ?? null,
    storage_path: args.storage_path ?? null,
    public_visible: args.public_visible ?? false,
    verified_by_user_id: args.verified_by_user_id ?? null,
    verified_at: args.verified_at ? args.verified_at.toISOString() : null,
  };

  const result = ParcelEvidenceSchema.safeParse(row);
  if (!result.success) {
    throw new GeoParcelsError(
      'INVALID_EVIDENCE',
      `evidence failed validation: ${result.error.message}`,
    );
  }

  const persisted = await port.insertEvidence(row);

  await appendActivity(port, {
    id: `${args.parcel_id}_evidence_${args.evidence_kind}_${Date.now()}`,
    tenant_id: args.tenant_id,
    parcel_id: args.parcel_id,
    event_kind: 'evidence_attached',
    event_payload_jsonb: {
      evidence_id: args.id,
      evidence_kind: args.evidence_kind,
      document_id: args.document_id ?? null,
      public_visible: args.public_visible ?? false,
      trust_score: args.trust_score ?? null,
    },
    actor_user_id: args.actor_user_id ?? args.verified_by_user_id ?? null,
    actor_persona_id: args.actor_persona_id ?? null,
  });

  return persisted;
}

export async function listEvidence(
  port: GeoParcelsPort,
  parcelId: string,
  tenantId: string,
): Promise<ParcelEvidence[]> {
  return port.listEvidence(parcelId, tenantId);
}
