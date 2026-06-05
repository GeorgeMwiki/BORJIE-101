-- =============================================================================
-- Down-migration 0283 — reverse training scenarios + learning progress.
--
-- Dev/staging only. Dropping these tables loses every generated scenario
-- template, every learner session transcript, and every per-concept mastery
-- snapshot. A production rollback must export these tables first if any
-- learning_progress rows are retained for compliance/credentialing.
--
-- Reverses migration 0283_training_scenarios_progress.sql. scenario_sessions
-- FK to scenarios (ON DELETE CASCADE), so we drop dependents first.
-- learning_progress is independent.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS learning_progress_tenant_isolation ON learning_progress;
DROP POLICY IF EXISTS scenario_sessions_tenant_isolation ON scenario_sessions;
DROP POLICY IF EXISTS scenarios_tenant_isolation         ON scenarios;

DROP INDEX IF EXISTS learning_progress_tenant_user;
DROP INDEX IF EXISTS learning_progress_tenant_user_concept_uq;
DROP INDEX IF EXISTS scenario_sessions_scenario;
DROP INDEX IF EXISTS scenario_sessions_tenant_user;
DROP INDEX IF EXISTS scenarios_tenant_status;
DROP INDEX IF EXISTS scenarios_tenant_kind;
DROP INDEX IF EXISTS scenarios_tenant_kind_difficulty_uq;

DROP TABLE IF EXISTS learning_progress;
DROP TABLE IF EXISTS scenario_sessions;
DROP TABLE IF EXISTS scenarios;

COMMIT;
