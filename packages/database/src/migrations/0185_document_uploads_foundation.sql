-- =============================================================================
-- Migration 0185 — document_uploads table + document_type enum (foundation)
--
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this file
-- after merge; append a new numbered file instead.
--
-- WHY THIS EXISTS (INT-7 / migration-apply-check):
--
--   The document_uploads table and document_type / document_status /
--   document_source enums were originally created by the archived migration
--   .archive/migrations/0032_document_uploads.sql, which was excluded from
--   the active migration chain during the property→mining rename (WS-6). As a
--   result, on a FRESH database:
--
--     * 0083_document_intelligence.sql (line 56) — ALTER TABLE document_uploads
--       fails with "relation does not exist".
--     * 0158_document_type_mining_values.sql (line 44) — ALTER TYPE document_type
--       fails with "type does not exist".
--
--   Both shipped files are immutable. This fixup migration creates the missing
--   foundation objects idempotently BEFORE any later migration needs them.
--   0083 and 0158 are allowlisted in migration-apply-allowlist.mjs (they
--   arrive before this fixup in lex order, so on fresh DB they are healed here).
--
-- TENANT ISOLATION:
--   document_uploads.tenant_id references tenants(id) with TEXT type — matching
--   tenants.id TEXT PRIMARY KEY established in drizzle/0000_borjie_bootstrap.sql.
--   RLS FORCE enabled (CLAUDE.md hard rule). Policy mirrors the 0032 archive.
--
-- IDEMPOTENT: all DDL guarded with IF NOT EXISTS / DO ... EXCEPTION blocks.
-- =============================================================================

BEGIN;

-- ─── Enums (guarded: pgEnum DO blocks are the Drizzle-migration convention) ──

DO $$ BEGIN
  CREATE TYPE document_type AS ENUM (
    'national_id',
    'passport',
    'driving_license',
    'work_permit',
    'residence_permit',
    'utility_bill',
    'bank_statement',
    'employment_letter',
    'lease_agreement',
    'move_in_report',
    'move_out_report',
    'maintenance_photo',
    'receipt',
    'notice',
    'other',
    -- Mining-domain values added by 0158_document_type_mining_values.sql.
    -- Including them here so 0158's ADD VALUE IF NOT EXISTS is a no-op.
    'mining_licence',
    'royalty_return',
    'accountant_export'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE document_status AS ENUM (
    'pending_upload',
    'uploaded',
    'processing',
    'ocr_complete',
    'validated',
    'rejected',
    'expired',
    'archived'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE document_source AS ENUM (
    'whatsapp',
    'app_upload',
    'email',
    'scan',
    'api',
    'manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── document_uploads ────────────────────────────────────────────────────────
-- Column shapes match the archived 0032 file + the intelligence-pipeline
-- columns added by 0083_document_intelligence.sql (kind, ingestion_status,
-- ingestion_error, ingested_at) so that 0083's ADD COLUMN IF NOT EXISTS is a
-- no-op on a fresh DB that has already applied this migration.

CREATE TABLE IF NOT EXISTS document_uploads (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  document_type           document_type NOT NULL,
  status                  document_status NOT NULL DEFAULT 'uploaded',
  source                  document_source NOT NULL DEFAULT 'app_upload',

  -- Intelligence-pipeline columns (added by 0083; included here so 0083 is
  -- a no-op on fresh DB).
  kind                    TEXT NOT NULL DEFAULT 'other',
  ingestion_status        TEXT NOT NULL DEFAULT 'queued',
  ingestion_error         TEXT,
  ingested_at             TIMESTAMPTZ,

  file_name               TEXT NOT NULL,
  file_size               INTEGER NOT NULL,
  mime_type               TEXT NOT NULL,
  file_url                TEXT NOT NULL,
  thumbnail_url           TEXT,

  quality_score           NUMERIC(5,2),
  quality_issues          JSONB DEFAULT '[]'::jsonb,
  quality_assessed_at     TIMESTAMPTZ,

  entity_type             TEXT,
  entity_id               TEXT,

  metadata                JSONB DEFAULT '{}'::jsonb,
  tags                    JSONB DEFAULT '[]'::jsonb,

  ocr_extraction_id       TEXT,

  verified_at             TIMESTAMPTZ,
  verified_by             TEXT,

  rejected_at             TIMESTAMPTZ,
  rejected_by             TEXT,
  rejection_reason        TEXT,

  expires_at              TIMESTAMPTZ,
  expiry_reminder_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  expiry_reminder_sent_at TIMESTAMPTZ,

  version                 INTEGER NOT NULL DEFAULT 1,
  previous_version_id     TEXT,
  access_level            TEXT DEFAULT 'private',

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              TEXT,
  updated_by              TEXT,
  deleted_at              TIMESTAMPTZ,
  deleted_by              TEXT
);

-- ─── Check constraints (idempotent) ──────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_uploads_kind_chk'
  ) THEN
    ALTER TABLE document_uploads
      ADD CONSTRAINT document_uploads_kind_chk
      CHECK (kind IN ('contract', 'rfp', 'letter', 'report', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_uploads_ingestion_status_chk'
  ) THEN
    ALTER TABLE document_uploads
      ADD CONSTRAINT document_uploads_ingestion_status_chk
      CHECK (ingestion_status IN ('queued', 'processing', 'ready', 'failed'));
  END IF;
END $$;

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS document_uploads_tenant_idx
  ON document_uploads (tenant_id);

CREATE INDEX IF NOT EXISTS document_uploads_type_idx
  ON document_uploads (document_type);

CREATE INDEX IF NOT EXISTS document_uploads_status_idx
  ON document_uploads (status);

CREATE INDEX IF NOT EXISTS document_uploads_entity_idx
  ON document_uploads (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS document_uploads_expires_at_idx
  ON document_uploads (expires_at);

-- Intelligence-pipeline indexes (0083 uses IF NOT EXISTS so they are no-ops).
CREATE INDEX IF NOT EXISTS idx_document_uploads_tenant_created
  ON document_uploads (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_uploads_ingestion_status
  ON document_uploads (tenant_id, ingestion_status)
  WHERE ingestion_status IN ('queued', 'processing');

-- ─── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE document_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_uploads FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'document_uploads'
       AND policyname = 'document_uploads_tenant_isolation'
  ) THEN
    CREATE POLICY document_uploads_tenant_isolation
      ON document_uploads
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
