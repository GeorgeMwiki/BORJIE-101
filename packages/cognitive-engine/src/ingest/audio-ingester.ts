/**
 * Audio ingester — Discipline 6, audio path.
 *
 * Delegates transcription to the caller-supplied
 * `DocumentParserPort.parseAudio` adapter (wraps
 * `@borjie/audio-capture` Whisper STT in production). PII-redacts the
 * transcript, registers a DataJoinRef.
 *
 * @module @borjie/cognitive-engine/ingest/audio-ingester
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

export interface IngestAudioInput {
  readonly attachment_id: string;
  readonly tenant_id: string;
  readonly session_id: string;
  readonly bytes: Uint8Array;
  readonly content_type: string;
  readonly intent_keywords: ReadonlyArray<string>;
  readonly retention_days?: number;
}

export interface IngestAudioDeps {
  readonly parser: DocumentParserPort;
  readonly storage: IngestStoragePort;
  readonly clock?: ClockPort;
}

const DEFAULT_RETENTION_DAYS = 14;

export async function ingestAudio(
  input: IngestAudioInput,
  deps: IngestAudioDeps,
): Promise<AdaptiveIngestResult> {
  const now = deps.clock?.now() ?? new Date();
  const stored = await deps.storage.put({
    tenant_id: input.tenant_id,
    session_id: input.session_id,
    attachment_id: input.attachment_id,
    bytes: input.bytes,
    content_type: input.content_type,
  });

  const { transcript } = await deps.parser.parseAudio(input.bytes);
  const { redactions } = redactPii(transcript, '$.audio_transcript');

  const join = buildDataJoinRef({
    attachment_id: input.attachment_id,
    tenant_id: input.tenant_id,
    session_id: input.session_id,
    storage_key: stored.storage_key,
    kind: 'audio',
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
    kind: 'audio',
    storage_key: stored.storage_key,
    parsed_columns: [],
    parsed_rows_count: 0,
    pii_redactions: redactions,
    inferred_data_join_ref: join,
    relevance_to_intent: relevance(transcript, input.intent_keywords),
    audit_hash: auditHash,
  };
}

function relevance(text: string, keywords: ReadonlyArray<string>): number {
  if (keywords.length === 0) return 0.5;
  const lower = text.toLowerCase();
  const hits = keywords.filter((k) => lower.includes(k.toLowerCase())).length;
  return Math.min(1, hits / Math.max(1, keywords.length));
}
