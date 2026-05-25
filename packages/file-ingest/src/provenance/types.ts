/**
 * Provenance carried by every attribute write. The shape is intentionally
 * narrow — anything that affects deterministic identity goes into the hash;
 * anything purely human-readable goes into the record.
 *
 * `hash` is computed from (prov-v3):
 *   sha256(
 *     tenant_id || ':' || file_hash || ':' || conversation_id || ':' ||
 *     message_id || ':' || ingest_plan_id || ':' || row_idx || ':' ||
 *     llm_inferred_schema_version
 *   )
 *
 * The same row, ingested for the same tenant, from the same file, in the
 * same message, by the same plan version, will always produce the same
 * provenance hash → idempotency on retries. Different tenants produce
 * different hashes (cross-tenant replay defence). Different messages
 * produce different hashes — DA1 MEDIUM fix: a re-upload via a NEW chat
 * message now lands cleanly (previously dedup blocked it).
 */
export interface Provenance {
  /** Tenant under which this attribute write is being committed. */
  readonly tenant_id: string;
  /** sha256 of the raw file bytes (lower-case hex). */
  readonly file_hash: string;
  /** Conversation in which the owner uploaded the file. */
  readonly conversation_id: string;
  /** The specific chat message that carried the file attachment. */
  readonly message_id: string;
  /** Zero-based row index within the inferred table. */
  readonly row_idx: number;
  /** Bump this whenever the schema-inference output format changes. */
  readonly llm_inferred_schema_version: string;
  /** Identifier of the IngestPlan that produced this write. */
  readonly ingest_plan_id: string;
  /** ISO-8601 timestamp at the moment the write was emitted. */
  readonly timestamp: string;
  /** Deterministic sha256 over the identity-bearing fields above. Lower-case hex. */
  readonly hash: string;
}

export interface ProvenanceSeed {
  readonly tenant_id: string;
  readonly file_hash: string;
  readonly conversation_id: string;
  readonly message_id: string;
  readonly row_idx: number;
  readonly llm_inferred_schema_version: string;
  readonly ingest_plan_id: string;
  readonly timestamp: string;
}
