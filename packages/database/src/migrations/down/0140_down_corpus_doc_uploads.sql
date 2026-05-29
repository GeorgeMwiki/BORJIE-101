-- =============================================================================
-- Down-migration for 0140_corpus_doc_uploads.sql
--
-- Reverses corpus_doc_uploads + corpus_doc_summaries.
--
-- ⚠️ DESTRUCTIVE — drops the entire company-brain ingestion lineage.
--    Dev/staging ONLY. Production has the append-only memory-durability
--    promise (Docs/OPS/MEMORY_DURABILITY.md).
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS corpus_doc_summaries CASCADE;
DROP TABLE IF EXISTS corpus_doc_uploads CASCADE;

COMMIT;
