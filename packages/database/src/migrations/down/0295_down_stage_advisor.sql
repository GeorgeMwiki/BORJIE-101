-- =============================================================================
-- Down-migration 0295 — reverse stage_advisor.
--
-- Dev/staging only. Dropping these tables loses the org's persisted stage
-- hysteresis state, the metrics/org-state snapshots, the nudge-delivery +
-- dismissal history, and the full stage-transition history. A production
-- rollback must export the snapshot + history tables first if any of that is
-- retained for audit / lifecycle analytics.
--
-- Drop order: append-only logs + dismissals first, then the snapshot tables.
-- (No cross-table FKs beyond tenants, so order is not strictly required, but we
-- keep a deterministic teardown.)
--
-- Reverses migration 0295_stage_advisor.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS stage_advisor_transitions_tenant_isolation
  ON stage_advisor_transitions;
DROP POLICY IF EXISTS stage_advisor_nudge_dismissals_tenant_isolation
  ON stage_advisor_nudge_dismissals;
DROP POLICY IF EXISTS stage_advisor_nudges_tenant_isolation
  ON stage_advisor_nudges;
DROP POLICY IF EXISTS stage_advisor_state_tenant_isolation
  ON stage_advisor_state;
DROP POLICY IF EXISTS stage_advisor_org_state_tenant_isolation
  ON stage_advisor_org_state;
DROP POLICY IF EXISTS stage_advisor_metrics_tenant_isolation
  ON stage_advisor_metrics;

DROP INDEX IF EXISTS stage_advisor_transitions_tenant_occurred_idx;
DROP INDEX IF EXISTS stage_advisor_transitions_tenant_idx;
DROP INDEX IF EXISTS stage_advisor_nudges_tenant_delivered_idx;
DROP INDEX IF EXISTS stage_advisor_nudges_tenant_nudge_idx;
DROP INDEX IF EXISTS stage_advisor_nudges_tenant_idx;

DROP TABLE IF EXISTS stage_advisor_transitions;
DROP TABLE IF EXISTS stage_advisor_nudge_dismissals;
DROP TABLE IF EXISTS stage_advisor_nudges;
DROP TABLE IF EXISTS stage_advisor_state;
DROP TABLE IF EXISTS stage_advisor_org_state;
DROP TABLE IF EXISTS stage_advisor_metrics;

COMMIT;
