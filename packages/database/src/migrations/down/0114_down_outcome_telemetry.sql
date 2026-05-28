-- =============================================================================
-- DOWN Migration 0114 - Outcome Telemetry (Wave CLOSED-LOOP)
--
-- Reverses 0114_outcome_telemetry.sql:
--   - DROP POLICY  outcome_reconciliations_tenant_isolation
--   - DROP POLICY  outcome_observations_tenant_isolation
--   - DROP POLICY  outcome_predictions_tenant_isolation
--   - DROP TABLE   outcome_reconciliations CASCADE
--   - DROP TABLE   outcome_observations    CASCADE
--   - DROP TABLE   outcome_predictions     CASCADE
--
-- Data loss: TRUE (every prediction / observation / reconciliation is
-- destroyed). The hash-chain entries linked via audit_hash_id remain
-- intact in ai_audit_chain - reverting this migration breaks reverse-
-- linking only, not the audit chain itself.
--
-- Envs:      dev | staging only (per registry policy).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS outcome_reconciliations_tenant_isolation ON outcome_reconciliations;
DROP POLICY IF EXISTS outcome_observations_tenant_isolation    ON outcome_observations;
DROP POLICY IF EXISTS outcome_predictions_tenant_isolation     ON outcome_predictions;

DROP TABLE IF EXISTS outcome_reconciliations CASCADE;
DROP TABLE IF EXISTS outcome_observations    CASCADE;
DROP TABLE IF EXISTS outcome_predictions     CASCADE;

COMMIT;
