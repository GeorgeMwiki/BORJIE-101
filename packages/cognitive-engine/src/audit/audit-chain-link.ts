/**
 * Audit-chain link — turn + ingest audit-hash builders.
 *
 * Reuses `@borjie/audit-hash-chain::canonicalJson` for deterministic
 * row hashing. The chain link is BOTH a per-turn hash (over the
 * reasoning trace + path + confidence) AND a per-ingest hash (over the
 * storage key + parsed columns + retention window).
 *
 * @module @borjie/cognitive-engine/audit/audit-chain-link
 */

import { canonicalJson } from '@borjie/audit-hash-chain';
import { createHash } from 'node:crypto';
import type { CognitiveTurnOutput, ReasoningTrace } from '../types.js';

export interface IngestHashInput {
  readonly attachment_id: string;
  readonly storage_key: string;
  readonly parsed_rows_count: number;
  readonly column_names: ReadonlyArray<string>;
  readonly retention_until_iso: string;
}

export function computeIngestAuditHash(input: IngestHashInput): string {
  const canon = canonicalJson({
    kind: 'cognitive_ingest',
    ...input,
  });
  return sha256Hex(canon);
}

export interface TurnHashInput {
  readonly turn_id: string;
  readonly tenant_id: string;
  readonly session_id: string;
  readonly path: CognitiveTurnOutput['path'];
  readonly confidence: CognitiveTurnOutput['confidence'];
  readonly reasoning_trace: ReasoningTrace;
  readonly citations: CognitiveTurnOutput['citations'];
  readonly occurred_at_iso: string;
}

export function computeTurnAuditHash(input: TurnHashInput): string {
  const canon = canonicalJson({
    kind: 'cognitive_turn',
    ...input,
  });
  return sha256Hex(canon);
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}
