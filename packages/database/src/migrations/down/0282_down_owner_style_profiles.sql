-- =============================================================================
-- DOWN 0282 — reverse the owner-style learned communication profile (gap-8).
--
-- Drops the owner_style_profiles table, its RLS policy, UNIQUE + CHECK
-- constraints, and the tenant/updated index. DATA LOSS: every learned
-- owner-style profile (the Dirichlet posteriors + headline categories) is
-- discarded — dev/staging only. A production rollback should export
-- profile_json first if the learned profiles carry value.
--
-- Idempotent: DROP TABLE IF EXISTS cascades the table's policy, constraints,
-- and index. Safe to re-run.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS owner_style_profiles CASCADE;

COMMIT;
