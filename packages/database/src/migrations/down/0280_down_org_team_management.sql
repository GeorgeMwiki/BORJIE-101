-- =============================================================================
-- DOWN 0280 — reverse org / team-management write surface (staff lifecycle).
--
-- Drops the four org/team-management tables, their RLS policies, CHECK
-- constraints, and indexes. DATA LOSS: any staff members, KPIs, tasks, and
-- escalations are discarded — dev/staging only. A production rollback must
-- export these tables first if any are forensic-retained.
--
-- Drop order respects FK dependency: org_escalations references org_tasks +
-- staff_members; org_tasks + staff_kpis reference staff_members. CASCADE makes
-- order moot, but explicit ordering keeps intent clear (dependents first).
--
-- Idempotent: DROP TABLE IF EXISTS cascades each table's policy, constraints,
-- and indexes. Safe to re-run.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS org_escalations CASCADE;
DROP TABLE IF EXISTS org_tasks CASCADE;
DROP TABLE IF EXISTS staff_kpis CASCADE;
DROP TABLE IF EXISTS staff_members CASCADE;

COMMIT;
