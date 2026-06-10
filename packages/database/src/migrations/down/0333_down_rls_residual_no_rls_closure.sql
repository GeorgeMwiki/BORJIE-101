-- =============================================================================
-- DOWN 0333 — remove the tenant-isolation + service-role-bypass RLS policies
-- from the 9 residual no-RLS tables closed by 0333 and DISABLE force/row-level
-- security. Idempotent: DROP POLICY IF EXISTS; ALTER is inherently idempotent.
-- DEV/STAGING ONLY — never run in production, this re-opens the cross-tenant
-- breach that 0333 closed (including the auth-adjacent person_links exposure).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS tenant_isolation_org_memberships          ON org_memberships;
DROP POLICY IF EXISTS org_memberships_service_role_bypass       ON org_memberships;
ALTER TABLE org_memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE org_memberships DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_invite_codes             ON invite_codes;
DROP POLICY IF EXISTS invite_codes_service_role_bypass          ON invite_codes;
ALTER TABLE invite_codes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE invite_codes DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_cross_tenant_denials     ON cross_tenant_denials;
DROP POLICY IF EXISTS cross_tenant_denials_service_role_bypass  ON cross_tenant_denials;
ALTER TABLE cross_tenant_denials NO FORCE ROW LEVEL SECURITY;
ALTER TABLE cross_tenant_denials DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_daily_revival_counters     ON daily_revival_counters;
DROP POLICY IF EXISTS daily_revival_counters_service_role_bypass  ON daily_revival_counters;
ALTER TABLE daily_revival_counters NO FORCE ROW LEVEL SECURITY;
ALTER TABLE daily_revival_counters DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_wave_progress            ON wave_progress;
DROP POLICY IF EXISTS wave_progress_service_role_bypass         ON wave_progress;
ALTER TABLE wave_progress NO FORCE ROW LEVEL SECURITY;
ALTER TABLE wave_progress DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_learning_observations     ON learning_observations;
DROP POLICY IF EXISTS learning_observations_service_role_bypass  ON learning_observations;
ALTER TABLE learning_observations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE learning_observations DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_ab_experiments           ON ab_experiments;
DROP POLICY IF EXISTS ab_experiments_service_role_bypass        ON ab_experiments;
ALTER TABLE ab_experiments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE ab_experiments DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_personal_memory_cells       ON personal_memory_cells;
DROP POLICY IF EXISTS personal_memory_cells_service_role_bypass    ON personal_memory_cells;
ALTER TABLE personal_memory_cells NO FORCE ROW LEVEL SECURITY;
ALTER TABLE personal_memory_cells DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_person_links             ON person_links;
DROP POLICY IF EXISTS person_links_service_role_bypass          ON person_links;
ALTER TABLE person_links NO FORCE ROW LEVEL SECURITY;
ALTER TABLE person_links DISABLE   ROW LEVEL SECURITY;

COMMIT;
