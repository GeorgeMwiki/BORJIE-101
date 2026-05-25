import { createHash } from 'node:crypto';

import type { Provenance, ProvenanceSeed } from './types.js';

/**
 * Hash recipe version. Bumped on every change to the field set OR field
 * order in {@link computeProvenanceHash}. Downstream comparators look at
 * this to know when two hashes are not directly comparable.
 *
 * v2 (2026-05-20): tenant_id added as the FIRST field. Prior versions
 * collided across tenants — a malicious second tenant could replay an
 * attribute write hash and bypass the idempotency check.
 *
 * v3 (2026-05-21, DA1 MEDIUM): message_id added between conversation_id
 * and ingest_plan_id. The earlier "ignores message_id" property let an
 * owner re-upload the SAME file under a DIFFERENT chat message and the
 * provenance hash collapsed back to the prior write, silently skipping
 * the new attribute writes (the user expected the second upload to
 * replace the first, but idempotency dedup blocked it). New semantics:
 *   - same message → same hash  (true idempotency on retries)
 *   - new message  → new hash   (re-upload always lands)
 */
export const PROVENANCE_HASH_VERSION = 'prov-v3';

/**
 * Compute a stable sha256 over the identity-bearing fields of a provenance
 * seed. Lower-case hex.
 *
 * Field order is FIXED — do NOT reorder; the same input must always produce
 * the same hash. The first field is `tenant_id`, which guarantees two
 * tenants ingesting an identical file produce different hashes (otherwise
 * an attacker who learnt a hash from one tenant could "replay" it into
 * another tenant's store and skip the write).
 *
 * v3 includes `message_id` so a re-upload via a NEW chat message produces
 * a NEW hash (the prior write was scoped to the prior message; the user's
 * mental model is "this message's file uploads, not the conversation's").
 *
 * Increment {@link PROVENANCE_HASH_VERSION} when the recipe changes.
 */
export function computeProvenanceHash(seed: ProvenanceSeed): string {
  const payload = [
    seed.tenant_id,
    seed.file_hash,
    seed.conversation_id,
    seed.message_id,
    seed.ingest_plan_id,
    String(seed.row_idx),
    seed.llm_inferred_schema_version,
  ].join(':');
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Build a full provenance record from a seed. The timestamp is preserved
 * exactly; the caller is responsible for any clock-stability concerns.
 */
export function buildProvenance(seed: ProvenanceSeed): Provenance {
  const hash = computeProvenanceHash(seed);
  return Object.freeze({
    tenant_id: seed.tenant_id,
    file_hash: seed.file_hash,
    conversation_id: seed.conversation_id,
    message_id: seed.message_id,
    row_idx: seed.row_idx,
    llm_inferred_schema_version: seed.llm_inferred_schema_version,
    ingest_plan_id: seed.ingest_plan_id,
    timestamp: seed.timestamp,
    hash,
  });
}

/**
 * Hash arbitrary file bytes. Used by callers to derive file_hash for a
 * Provenance record from the original upload.
 */
export function hashFileBytes(bytes: Uint8Array | Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}
