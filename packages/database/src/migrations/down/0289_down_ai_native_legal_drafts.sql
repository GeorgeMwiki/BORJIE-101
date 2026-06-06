-- =============================================================================
-- Down-migration 0289 — reverse legal_drafts.
--
-- Dev/staging only. Dropping this table loses every AI-native legal draft. A
-- production rollback must export the table first if any drafts are retained for
-- audit / legal-record purposes (drafts may underpin notices already served).
--
-- Reverses migration 0289_ai_native_legal_drafts.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS legal_drafts_tenant_isolation
  ON legal_drafts;

DROP INDEX IF EXISTS idx_legal_drafts_review_queue;
DROP INDEX IF EXISTS idx_legal_drafts_tenant_kind_created;
DROP INDEX IF EXISTS idx_legal_drafts_tenant_created;

DROP TABLE IF EXISTS legal_drafts;

COMMIT;
