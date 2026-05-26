/**
 * DataJoinRef registrar — Discipline 6 final step.
 *
 * Stamps the parsed payload as a `DataJoinRef` available to all five
 * capabilities for the rest of the session. Pure builder — actual
 * persistence happens in the runtime (`cognitive_turns` + uploaded
 * attachments table).
 *
 * @module @borjie/cognitive-engine/ingest/data-join-registrar
 */

import type { DataJoinRef, IngestKind } from '../types.js';

export interface BuildJoinInput {
  readonly attachment_id: string;
  readonly tenant_id: string;
  readonly session_id: string;
  readonly storage_key: string;
  readonly kind: IngestKind;
  readonly retention_days: number;
  readonly now: Date;
}

export function buildDataJoinRef(input: BuildJoinInput): DataJoinRef {
  const retain = new Date(input.now.getTime());
  retain.setUTCDate(retain.getUTCDate() + Math.max(1, input.retention_days));
  return {
    join_id: `join_${input.attachment_id}`,
    kind: mapKind(input.kind),
    storage_key: input.storage_key,
    tenant_id: input.tenant_id,
    session_id: input.session_id,
    retention_until_iso: retain.toISOString(),
  };
}

function mapKind(k: IngestKind): DataJoinRef['kind'] {
  switch (k) {
    case 'excel':
    case 'csv':
      return 'tabular';
    case 'pdf':
      return 'document';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    default:
      return 'document';
  }
}
