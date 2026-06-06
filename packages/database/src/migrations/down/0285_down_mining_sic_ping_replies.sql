-- =============================================================================
-- Down-migration 0285 — reverse mining_sic_ping_replies.
--
-- Dev/staging only. Dropping this table loses every worker SIC-ping reply
-- (loads done + blockers). A production rollback must export the table first
-- if any reply rows are retained for shift-record / audit purposes.
--
-- Reverses migration 0285_mining_sic_ping_replies.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS mining_sic_ping_replies_tenant_isolation
  ON mining_sic_ping_replies;

DROP INDEX IF EXISTS idx_mining_sic_ping_replies_ping;
DROP INDEX IF EXISTS idx_mining_sic_ping_replies_tenant_replied_at;

DROP TABLE IF EXISTS mining_sic_ping_replies;

COMMIT;
