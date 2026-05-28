-- =============================================================================
-- DOWN Migration 0116 - Decision Journal (Wave DECISION-LEGIBILITY)
--
-- Reverses 0116_decision_journal.sql:
--   - DROP POLICY decisions_tenant_isolation
--   - DROP POLICY decision_outcomes_tenant_isolation
--   - DROP POLICY decision_links_tenant_isolation
--   - DROP TABLE decision_links / decision_outcomes / decisions CASCADE
--
-- Data loss: TRUE. The immutable AI audit chain in `ai_audit_chain`
-- retains the underlying WRITE records; only the decision-rationale,
-- outcome grades, and link graph are lost.
-- Envs:      dev | staging only (per registry policy).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS decision_links_tenant_isolation ON decision_links;
DROP POLICY IF EXISTS decision_outcomes_tenant_isolation ON decision_outcomes;
DROP POLICY IF EXISTS decisions_tenant_isolation ON decisions;

DROP TABLE IF EXISTS decision_links CASCADE;
DROP TABLE IF EXISTS decision_outcomes CASCADE;
DROP TABLE IF EXISTS decisions CASCADE;

COMMIT;
