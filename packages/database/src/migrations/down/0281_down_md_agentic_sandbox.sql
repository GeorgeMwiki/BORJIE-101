-- =============================================================================
-- DOWN 0281 — reverse agentic plan / subagent + sandbox-preview write surface.
--
-- Drops the five md-agentic tables, their RLS policies, CHECK constraints, and
-- indexes. DATA LOSS: any proposed plans, subagent runs, staged sandbox
-- writes, and the commit / reject audit logs are discarded — dev/staging only.
-- A production rollback must export the commit / reject logs first (audit
-- evidence).
--
-- Drop order respects FK dependency: md_sandbox_commits + md_sandbox_rejects
-- reference md_sandbox_writes; md_subagent_runs + md_sandbox_writes reference
-- md_plans. CASCADE makes order moot, but explicit ordering keeps intent clear
-- (dependents first).
--
-- Idempotent: DROP TABLE IF EXISTS cascades each table's policy, constraints,
-- and indexes. Safe to re-run.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS md_sandbox_rejects CASCADE;
DROP TABLE IF EXISTS md_sandbox_commits CASCADE;
DROP TABLE IF EXISTS md_sandbox_writes CASCADE;
DROP TABLE IF EXISTS md_subagent_runs CASCADE;
DROP TABLE IF EXISTS md_plans CASCADE;

COMMIT;
