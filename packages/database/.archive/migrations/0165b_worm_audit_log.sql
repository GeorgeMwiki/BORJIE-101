-- ============================================================================
-- Migration 0165 — WORM (write-once-read-many) audit log for documents.
--
-- Persistent backing for the `WormAuditStore` port declared in
-- `packages/document-studio/src/signing/worm-audit.ts`. Append-only,
-- hash-chained per tenant, SOC 2 / GDPR Art. 30 audit substrate for
-- every generated document leaving document-studio.
--
-- Chain shape:
--   chain_hash = sha256(entry_id || tenant_id || actor_id
--                       || document_kind || document_id
--                       || rendered_at_iso || rendered_sha256
--                       || citations_sha256 || previous_entry_hash)
--
-- Backwards-compatible: CREATE TABLE / INDEX IF NOT EXISTS only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS worm_audit_log (
  entry_id            TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  actor_id            TEXT NOT NULL,
  document_kind       TEXT NOT NULL,
  document_id         TEXT NOT NULL,
  rendered_at_iso     TEXT NOT NULL,
  rendered_sha256     TEXT NOT NULL,
  citations_sha256    TEXT NOT NULL,
  previous_entry_hash TEXT,
  chain_hash          TEXT NOT NULL,
  sequence_number     INTEGER NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_worm_audit_tenant_sequence
  ON worm_audit_log (tenant_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_worm_audit_tenant_sequence
  ON worm_audit_log (tenant_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_worm_audit_chain_hash
  ON worm_audit_log (chain_hash);

COMMENT ON TABLE worm_audit_log IS
  'WORM audit substrate for document-studio rendered documents. Hash-chained per tenant.';
COMMENT ON COLUMN worm_audit_log.chain_hash IS
  'sha256(entry_id || tenant_id || ... || previous_entry_hash). Mutation breaks the chain.';
