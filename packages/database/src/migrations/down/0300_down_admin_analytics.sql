-- =============================================================================
-- Down-migration 0300 — reverse admin_analytics.
--
-- Dev/staging only. Dropping these tables DISCARDS:
--   * every A/B experiment (ab_experiments),
--   * the ENTIRE product activation-funnel event history (activation_events),
--   * every minted regulator audit-pack (audit_packs).
-- A production rollback must export all three first if any history is retained
-- for audit / analytics / compliance purposes.
--
-- Drop order: policies first, then indexes, then tables (no inter-table FKs
-- among these three, so table order is independent).
--
-- Reverses migration 0300_admin_analytics.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS audit_packs_tenant_isolation       ON audit_packs;
DROP POLICY IF EXISTS activation_events_tenant_isolation ON activation_events;

DROP INDEX IF EXISTS audit_packs_status_idx;
DROP INDEX IF EXISTS audit_packs_tenant_issued_idx;
DROP INDEX IF EXISTS audit_packs_tenant_idx;
DROP INDEX IF EXISTS activation_events_tenant_occurred_idx;
DROP INDEX IF EXISTS activation_events_type_occurred_idx;
DROP INDEX IF EXISTS activation_events_tenant_type_idx;
DROP INDEX IF EXISTS activation_events_tenant_idx;
DROP INDEX IF EXISTS ab_experiments_created_idx;
DROP INDEX IF EXISTS ab_experiments_junior_idx;
DROP INDEX IF EXISTS ab_experiments_status_idx;

DROP TABLE IF EXISTS audit_packs;
DROP TABLE IF EXISTS activation_events;
DROP TABLE IF EXISTS ab_experiments;

COMMIT;
