-- =============================================================================
-- Down-migration 0299 — reverse conformal_calibration.
--
-- Dev/staging only. Dropping these tables loses every persisted prediction,
-- observation, and the learned online-ACI state (alpha resets to the cold-start
-- default 0.1). A production rollback must export the three tables first if the
-- calibration history is retained for audit / model-governance.
--
-- Reverses migration 0299_conformal_calibration.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS conformal_calibration_state_tenant_isolation
  ON conformal_calibration_state;
DROP POLICY IF EXISTS conformal_observations_tenant_isolation
  ON conformal_observations;
DROP POLICY IF EXISTS conformal_predictions_tenant_isolation
  ON conformal_predictions;

DROP INDEX IF EXISTS idx_conformal_state_tenant_type;
DROP INDEX IF EXISTS idx_conformal_observations_tenant_type_at;
DROP INDEX IF EXISTS idx_conformal_predictions_tenant_type_at;

DROP TABLE IF EXISTS conformal_calibration_state;
DROP TABLE IF EXISTS conformal_observations;
DROP TABLE IF EXISTS conformal_predictions;

COMMIT;
