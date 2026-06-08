-- =============================================================================
-- Down-migration 0308 — reverse flow_autonomy_prefs.
--
-- Dev/staging only. Dropping this table loses every per-flow autonomy posture
-- and creation-time confirmation. The fail-safe consequence is benign: with no
-- posture rows, every flow resolves to GATED (the default) — autonomy simply
-- reverts to fully human-gated, which is the safe direction. No money/licence/
-- ledger records live here; rails are unaffected (they never depended on this
-- table).
--
-- Reverses migration 0308_flow_autonomy_prefs.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS flow_autonomy_prefs_service_role_bypass
  ON flow_autonomy_prefs;
DROP POLICY IF EXISTS flow_autonomy_prefs_tenant_isolation
  ON flow_autonomy_prefs;

DROP INDEX IF EXISTS idx_flow_autonomy_prefs_tenant_confirmation;
DROP INDEX IF EXISTS idx_flow_autonomy_prefs_tenant;

DROP TABLE IF EXISTS flow_autonomy_prefs;

COMMIT;
