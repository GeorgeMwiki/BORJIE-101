-- =============================================================================
-- Down-migration 0287 — reverse price_recommendations.
--
-- Dev/staging only. Dropping this table loses every AI-native dynamic-pricing
-- proposal. A production rollback must export the table first if any proposed
-- recommendations are retained for audit / pricing-history purposes.
--
-- Reverses migration 0287_ai_native_price_recommendations.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS price_recommendations_tenant_isolation
  ON price_recommendations;

DROP INDEX IF EXISTS idx_price_recommendations_tenant_created;
DROP INDEX IF EXISTS idx_price_recommendations_tenant_pit_created;

DROP TABLE IF EXISTS price_recommendations;

COMMIT;
