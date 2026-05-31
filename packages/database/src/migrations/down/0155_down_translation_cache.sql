-- =============================================================================
-- DOWN 0155: revert translation_cache.
--
-- WARNING: DATA LOSS. Dropping the table loses every cached translation —
-- next run will re-invoke Claude / Gemini / NLLB for each unique string.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS translation_cache;

COMMIT;
