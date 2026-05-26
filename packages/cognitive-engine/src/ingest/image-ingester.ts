/**
 * Image ingester — Discipline 6, image path.
 *
 * Delegates to the caller-supplied `DocumentParserPort.parseImage`
 * adapter (Anthropic Haiku 4.5 vision in production). Captures caption
 * + OCR text, runs PII redaction over both, and registers the
 * DataJoinRef.
 *
 * @module @borjie/cognitive-engine/ingest/image-ingester
 */

import type {
  AdaptiveIngestResult,
  ClockPort,
  DocumentParserPort,
  IngestStoragePort,
} from '../types.js';
import { redactPii } from './pii-redactor.js';
import { buildDataJoinRef } from './data-join-registrar.js';
import { computeIngestAuditHash } from '../audit/audit-chain-link.js';

export interface IngestImageInput {
  readonly attachment_id: string;
  readonly tenant_id: string;
  readonly session_id: string;
  readonly bytes: Uint8Array;
  readonly content_type: string;
  readonly intent_keywords: ReadonlyArray<string>;
  readonly retention_days?: number;
}

export interface IngestImageDeps {
  readonly parser: DocumentParserPort;
  readonly storage: IngestStoragePort;
  readonly clock?: ClockPort;
}

const DEFAULT_RETENTION_DAYS = 14;

export async function ingestImage(
  input: IngestImageInput,
  deps: IngestImageDeps,
): Promise<AdaptiveIngestResult> {
  const now = deps.clock?.now() ?? new Date();
  const stored = await deps.storage.put({
    tenant_id: input.tenant_id,
    session_id: input.session_id,
    attachment_id: input.attachment_id,
    bytes: input.bytes,
    content_type: input.content_type,
  });

  const parsed = await deps.parser.parseImage(input.bytes);
  const captionRedacted = redactPii(parsed.caption, '$.image_caption');
  const ocrRedacted = redactPii(parsed.ocrText, '$.image_ocr');
  const combinedRedactions = [
    ...captionRedacted.redactions,
    ...ocrRedacted.redactions,
  ];

  const join = buildDataJoinRef({
    attachment_id: input.attachment_id,
    tenant_id: input.tenant_id,
    session_id: input.session_id,
    storage_key: stored.storage_key,
    kind: 'image',
    retention_days: input.retention_days ?? DEFAULT_RETENTION_DAYS,
    now,
  });

  const auditHash = computeIngestAuditHash({
    attachment_id: input.attachment_id,
    storage_key: stored.storage_key,
    parsed_rows_count: 0,
    column_names: [],
    retention_until_iso: join.retention_until_iso,
  });

  return {
    attachment_id: input.attachment_id,
    kind: 'image',
    storage_key: stored.storage_key,
    parsed_columns: [],
    parsed_rows_count: 0,
    pii_redactions: combinedRedactions,
    inferred_data_join_ref: join,
    relevance_to_intent: relevance(parsed.caption, input.intent_keywords),
    audit_hash: auditHash,
  };
}

function relevance(text: string, keywords: ReadonlyArray<string>): number {
  if (keywords.length === 0) return 0.5;
  const lower = text.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k.toLowerCase())).length;
  return Math.min(1, hits / Math.max(1, keywords.length));
}
