-- =============================================================================
-- 0032: document_uploads — reconcile schema/DB drift
-- =============================================================================
-- `packages/database/src/schemas/documents.schema.ts` defines an intelligence-
-- grade `document_uploads` table (with OCR, quality, verification, expiry,
-- versioning) and `ocr_extractions` / `identity_profiles` / `verification_
-- badges` tables all FK-reference `document_upload_id`. The simpler legacy
-- `documents` table (migration 0004) has none of those fields.
--
-- The live DB has `documents` but never had `document_uploads`, which made
-- `GET /api/v1/documents` explode with
--   PostgresError: relation "document_uploads" does not exist
--
-- This migration creates `document_uploads` exactly as the schema expects, so
-- the DocumentRepository (which queries `document_uploads`) now resolves.
-- We keep the legacy `documents` table in place — it is referenced by
-- `document_access` and still needed by older code paths.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Enums (guarded: pgEnum DO blocks are the Drizzle-migration convention used
-- elsewhere in this repo — CREATE TYPE doesn't support IF NOT EXISTS).
-- ----------------------------------------------------------------------------

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
    'other'
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

-- ----------------------------------------------------------------------------
-- document_uploads
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_uploads (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id             TEXT REFERENCES customers(id) ON DELETE SET NULL,

  document_type           document_type NOT NULL,
  status                  document_status NOT NULL DEFAULT 'uploaded',
  source                  document_source NOT NULL DEFAULT 'app_upload',

  file_name               TEXT NOT NULL,
  file_size               INTEGER NOT NULL,
  mime_type               TEXT NOT NULL,
  file_url                TEXT NOT NULL,
  thumbnail_url           TEXT,

  quality_score           NUMERIC(5, 2),
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

CREATE INDEX IF NOT EXISTS document_uploads_tenant_idx      ON document_uploads(tenant_id);
CREATE INDEX IF NOT EXISTS document_uploads_customer_idx    ON document_uploads(customer_id);
CREATE INDEX IF NOT EXISTS document_uploads_type_idx        ON document_uploads(document_type);
CREATE INDEX IF NOT EXISTS document_uploads_status_idx      ON document_uploads(status);
CREATE INDEX IF NOT EXISTS document_uploads_entity_idx      ON document_uploads(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS document_uploads_expires_at_idx  ON document_uploads(expires_at);

-- updated_at trigger — the function is installed by 0001_initial.sql
DROP TRIGGER IF EXISTS document_uploads_updated_at ON document_uploads;
CREATE TRIGGER document_uploads_updated_at
  BEFORE UPDATE ON document_uploads
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Row-Level Security — mirrors the pattern used by every other tenant-scoped
-- table in this codebase. Without this, the RLS set by databaseMiddleware
-- (`SELECT set_config('app.current_tenant_id', ...)`) would be bypassed here.
ALTER TABLE document_uploads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_uploads_tenant_isolation ON document_uploads;
CREATE POLICY document_uploads_tenant_isolation ON document_uploads
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
