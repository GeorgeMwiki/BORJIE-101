-- =============================================================================
-- 0217: Complete the Piece K ↔ legacy documents unification.
--
-- Companion to 0216 — that migration successfully landed entity_type_definition
-- but its FK addition on core_entity.entity_type failed (slug alone isn't unique
-- since the same slug can be re-used per-tenant). The FK is dropped from the
-- design — application-level validation handles entity_type integrity, matching
-- the soft-pointer pattern already in use by Piece K + Piece F.
--
-- This migration completes the remaining work that 0216 didn't reach:
--   1. Add Piece K OCR / processing-state columns to legacy `documents`
--   2. Create `document_entity_resolutions` (resolution layer)
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extend legacy `documents` with Piece K OCR / processing-state columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS sha256              text,
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id text REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS filename            text,
  ADD COLUMN IF NOT EXISTS page_count          integer,
  ADD COLUMN IF NOT EXISTS ocr_text            text,
  ADD COLUMN IF NOT EXISTS ocr_language        text,
  ADD COLUMN IF NOT EXISTS processing_state    text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_error    text,
  ADD COLUMN IF NOT EXISTS source_channel      text,
  ADD COLUMN IF NOT EXISTS related_thread_id   text;

UPDATE documents SET filename = name WHERE filename IS NULL AND name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_sha256_uniq
  ON documents (tenant_id, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_tenant_state_idx
  ON documents (tenant_id, processing_state);
CREATE INDEX IF NOT EXISTS documents_tenant_created_idx
  ON documents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_thread_idx
  ON documents (related_thread_id) WHERE related_thread_id IS NOT NULL;

COMMENT ON COLUMN documents.sha256           IS 'Piece K — content-addressed dedupe.';
COMMENT ON COLUMN documents.ocr_text         IS 'Piece K — full extracted text (EN+SW).';
COMMENT ON COLUMN documents.processing_state IS 'Piece K — pending|ocr_done|parsed|extracted|routed|done|error.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Piece K entity-resolution layer
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_entity_resolutions (
  id                       text PRIMARY KEY,
  document_id              text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id                text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  extraction_id            text NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,
  resolved_entity_id       text REFERENCES core_entity(id) ON DELETE SET NULL,
  resolution_confidence    numeric(5,4) NOT NULL,
  resolution_method        text NOT NULL,
  resolution_hitl_status   text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_entity_resolutions_tenant_idx
  ON document_entity_resolutions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_entity_resolutions_resolved_idx
  ON document_entity_resolutions (resolved_entity_id) WHERE resolved_entity_id IS NOT NULL;

ALTER TABLE document_entity_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_entity_resolutions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_entity_resolutions_select ON document_entity_resolutions;
CREATE POLICY document_entity_resolutions_select
  ON document_entity_resolutions FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS document_entity_resolutions_modify ON document_entity_resolutions;
CREATE POLICY document_entity_resolutions_modify
  ON document_entity_resolutions FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

REVOKE ALL ON document_entity_resolutions FROM anon;
GRANT SELECT ON document_entity_resolutions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_entity_resolutions TO service_role;

COMMENT ON TABLE document_entity_resolutions IS 'Piece K — resolution layer linking document extractions to canonical core_entity rows. Supersedes the original 0213/0215 design that collided with legacy document_entities.';
