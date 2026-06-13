-- =============================================================================
-- Down-migration 0349 — drop self_healing_proposals.
--
-- Dev/staging only — DATA LOSS. Drops the internal-admin self-healing console
-- queue created by 0349 (table + indexes + RLS policy fall with it). Only for
-- a clean apply→reverse test on a throwaway DB.
--
-- Reverses migration 0349_self_healing_proposals.sql.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS self_healing_proposals CASCADE;

COMMIT;
