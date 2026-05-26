/**
 * Audit-chain link — ResearchResult → @borjie/audit-hash-chain entry.
 *
 * DEEP_RESEARCH_SPEC §4.5 + §8: every result MUST be canonical-JSON
 * hashed and appended to the tenant's audit_hash_chain. The chain row's
 * payload is the canonical-JSON of:
 *   { result_id, plan_id, summary_hash, citation_hashes, model_id, cost, elapsed_ms }
 *
 * Also exposes a per-artifact hashing helper so adapters can stamp
 * `artifact.audit_hash` before returning. Two distinct concerns:
 *   1. `hashArtifact()` — adapter-side, hashes a single retrieved row.
 *   2. `buildResultAuditPayload()` — synthesizer-side, hashes the full
 *      ResearchResult for append into the chain.
 *
 * Pure — reuses `canonicalJson` + `hashChainEntry` from audit-hash-chain.
 *
 * @module @borjie/research-tools/audit/audit-chain-link
 */

import {
  canonicalJson,
  hashChainEntry,
  type AuditPayload,
} from '@borjie/audit-hash-chain';
import { createHash } from 'node:crypto';
import type { ResearchArtifact, ResearchResult } from '../types.js';

// ---------------------------------------------------------------------------
// Artifact hashing — called by every adapter
// ===========================================================================

/**
 * Compute a stable sha256 hex hash for a freshly-retrieved artifact.
 * Adapters call this BEFORE returning so the chain can later verify
 * that the artifact content matches the one referenced by the
 * synthesised result.
 */
export function hashArtifact(args: {
  readonly source_uri: string;
  readonly content: string;
  readonly retrieved_at: string;
  readonly tool_name: string;
}): string {
  const canonical = canonicalJson({
    source_uri: args.source_uri,
    content: args.content,
    retrieved_at: args.retrieved_at,
    tool_name: args.tool_name,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// ---------------------------------------------------------------------------
// Result audit payload — for `appendEntry()` into the chain
// ===========================================================================

export interface ResultAuditPayloadInput {
  readonly result: ResearchResult;
  readonly model_id: string;
}

/**
 * Build the canonical audit payload that the Synthesizer appends to
 * the tenant's hash chain via `appendEntry()`. The payload is opaque
 * to the chain primitive; we just need the field names to be stable
 * + the JSON to be canonical so the hash is reproducible.
 */
export function buildResultAuditPayload(
  input: ResultAuditPayloadInput,
): AuditPayload {
  const summary_hash = createHash('sha256')
    .update(input.result.summary_md)
    .digest('hex');
  const citation_hashes = input.result.span_citations.map((c) =>
    createHash('sha256')
      .update(`${c.citationId}|${c.sourceUri}|${c.quotedSpan}`)
      .digest('hex'),
  );
  return {
    kind: 'research_result',
    result_id: input.result.id,
    plan_id: input.result.plan_id,
    summary_hash,
    citation_count: input.result.span_citations.length,
    citation_hashes,
    confidence: input.result.confidence,
    disagreement_count: input.result.disagreements.length,
    model_id: input.model_id,
    cost_usd_cents: input.result.total_cost_usd_cents,
    elapsed_ms: input.result.total_duration_ms,
    generated_at: input.result.generated_at,
  };
}

/**
 * One-shot: compute the row hash for a result without appending. Useful
 * when callers want to stamp `result.audit_hash` BEFORE the chain
 * append (e.g. for streaming the result to the owner while the chain
 * append is still in flight).
 */
export function computeResultAuditHash(args: {
  readonly result: ResearchResult;
  readonly model_id: string;
  readonly prevHash?: string;
  readonly secretId?: string;
  readonly secretValue?: string;
}): string {
  const payload = buildResultAuditPayload({
    result: args.result,
    model_id: args.model_id,
  });
  return hashChainEntry({
    ...(args.prevHash !== undefined ? { prev: args.prevHash } : {}),
    payload,
    ...(args.secretId !== undefined ? { secretId: args.secretId } : {}),
    ...(args.secretValue !== undefined ? { secretValue: args.secretValue } : {}),
  });
}

/**
 * Audit-artifact summary that the orchestrator can store in
 * `research_artifacts.audit_hash` (DDL §14). Adapter pipeline:
 *   1. Fetch raw bytes from the source.
 *   2. Call `hashArtifact(...)` to seal the bytes.
 *   3. Score via `scoreSource(...)`.
 *   4. Return ResearchArtifact with `audit_hash` populated.
 */
export interface ArtifactAuditSummary {
  readonly artifact_id: string;
  readonly source_uri: string;
  readonly content_hash: string;
}

export function summariseArtifactAudit(
  artifact: ResearchArtifact,
): ArtifactAuditSummary {
  return {
    artifact_id: artifact.id,
    source_uri: artifact.source_uri,
    content_hash: artifact.audit_hash,
  };
}
