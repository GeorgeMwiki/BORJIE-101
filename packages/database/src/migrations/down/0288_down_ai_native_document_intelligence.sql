-- =============================================================================
-- Down-migration 0288 — reverse document_entities + document_obligations.
--
-- Dev/staging only. Dropping these tables loses every AI-native doc-intelligence
-- extraction (entities + obligations). A production rollback must export both
-- tables first if any extractions are retained for audit / compliance purposes.
--
-- Reverses migration 0288_ai_native_document_intelligence.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS document_obligations_tenant_isolation
  ON document_obligations;
DROP POLICY IF EXISTS document_entities_tenant_isolation
  ON document_entities;

DROP INDEX IF EXISTS idx_document_obligations_tenant_due;
DROP INDEX IF EXISTS idx_document_obligations_tenant_document;
DROP INDEX IF EXISTS idx_document_entities_tenant_kind;
DROP INDEX IF EXISTS idx_document_entities_tenant_document;

DROP TABLE IF EXISTS document_obligations;
DROP TABLE IF EXISTS document_entities;

COMMIT;
