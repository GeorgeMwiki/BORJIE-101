-- =============================================================================
-- Down-migration for 0151_learning_amplification.sql.
--
-- Reverses the learning-amplification tables + view ported from LitFin.
--
-- DESTRUCTIVE: drops 30d+ of observation history and the cohort view.
--    Dev/staging ONLY — production users rely on these rows to keep
--    user-N smarter than user-(N-1).
-- =============================================================================

BEGIN;

DROP VIEW  IF EXISTS learning_cohort_stats;

DROP INDEX IF EXISTS truth_review_queue_pending_idx;
DROP INDEX IF EXISTS truth_review_queue_claim_idx;
DROP TABLE IF EXISTS truth_review_queue;

DROP INDEX IF EXISTS learning_observations_kind_idx;
DROP INDEX IF EXISTS learning_observations_subject_idx;
DROP INDEX IF EXISTS learning_observations_tenant_idx;
DROP INDEX IF EXISTS learning_observations_correlation_idx;
DROP TABLE IF EXISTS learning_observations;

COMMIT;
