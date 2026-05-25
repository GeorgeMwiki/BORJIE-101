-- ─────────────────────────────────────────────────────────────────────
-- Migration 0143 — Field-level encryption-at-rest audit table.
--
-- Phase D D1. Closes the production gap surfaced by the audit:
-- `data-classification.ts` declares `encryptAtRest: true` on ~30
-- PII columns (KRA PIN, NIDA, MFA secrets, M-Pesa phone, document
-- URLs, voice transcripts) but no app-layer middleware actually
-- encrypts/decrypts them. The Drizzle middleware in
-- `packages/database/src/security/encryption/` does the work; this
-- table is the AUDIT TRAIL that lets operators see WHICH ROWS were
-- encrypted with WHICH key generation — required for the rotation
-- runbook in `Docs/SECURITY/ENCRYPTION_AT_REST.md`.
--
-- Append-only by convention. The DELETE path is reserved for the
-- GDPR right-to-be-forgotten orchestrator only.
--
-- Regulatory anchors:
--   - GDPR Art.32 — encryption of personal data; verifiable controls
--   - TZ PDPA s.30 — controller-implemented encryption
--   - SOC 2 CC6.7 — protection of data at rest
--   - ISO 27001 A.10.1 — cryptographic-controls policy + audit
--
-- The (tenant_id, table_name, column_name, row_id) tuple is intentionally
-- NOT unique — one logical row can be re-encrypted N times under
-- different key versions during the lifetime of a tenant. The audit
-- table is the canonical record of every such transition.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS field_encryption_audit (
  id              TEXT PRIMARY KEY,
  /** NULL allowed — platform-tier rows (audit_events.actor_email etc.)
      are not tenant-scoped. The middleware derives against the
      _platform key scope when tenant_id is NULL. */
  tenant_id       TEXT,
  table_name      TEXT NOT NULL,
  column_name     TEXT NOT NULL,
  /** Logical row identifier (typically a UUID PK). NULLABLE so the
      middleware can record bulk operations where the per-row id is
      not yet known (e.g. pre-insert batch encryption). */
  row_id          TEXT,
  /** Master-key generation that derived the DEK for this row. Bumped
      by `ENCRYPTION_MASTER_KEY_VERSION` rotation. */
  key_version     INTEGER NOT NULL,
  encrypted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Stamped by the rotation script after a row is re-encrypted under
      the new generation. NULL until rotated. */
  rotated_at      TIMESTAMPTZ
);

-- Lookup by (tenant, table, column) — powers per-column rotation
-- audit ("how many customers.kra_pin rows are still on v1?").
CREATE INDEX IF NOT EXISTS idx_field_encryption_audit_scope
  ON field_encryption_audit (tenant_id, table_name, column_name, key_version);

-- Per-row history lookup — operator can replay the rotation history
-- for a single PII row when handling a DSAR.
CREATE INDEX IF NOT EXISTS idx_field_encryption_audit_row
  ON field_encryption_audit (table_name, row_id, encrypted_at DESC);

-- Time-based scan — supports the nightly rotation-coverage report.
CREATE INDEX IF NOT EXISTS idx_field_encryption_audit_time
  ON field_encryption_audit (encrypted_at DESC);

COMMENT ON TABLE field_encryption_audit IS
  'Append-only audit trail of every field-level encryption write. Powers key-rotation coverage reports and SOC 2 evidence (CC6.7).';

COMMENT ON COLUMN field_encryption_audit.key_version IS
  'Master-key generation that derived the DEK. Bumped by ENCRYPTION_MASTER_KEY_VERSION rotation; rotated_at stamps the re-encryption transition.';

COMMENT ON COLUMN field_encryption_audit.tenant_id IS
  'NULL means platform-tier (audit_events.actor_email etc.). Per-tenant rows MUST set this; the encryption middleware derives the DEK against the tenant scope.';
