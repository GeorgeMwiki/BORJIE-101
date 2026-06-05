-- =============================================================================
-- DOWN 0278 — reverse admin_superpower_pending_approvals (mining four-eye queue).
--
-- Drops the admin four-eye pending-approvals queue table, its RLS policy, its
-- CHECK constraints, and its indexes. DATA LOSS: any in-flight pending HIGH-
-- risk admin proposals are discarded — dev/staging only.
--
-- Idempotent: DROP TABLE IF EXISTS cascades the policy, constraints, and
-- indexes. Safe to re-run.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS admin_superpower_pending_approvals CASCADE;

COMMIT;
