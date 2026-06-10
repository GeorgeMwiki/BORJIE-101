-- =============================================================================
-- DOWN 0331 — remove the tenant-isolation + service-role-bypass RLS policies
-- from users / organizations / owner_skills and DISABLE force/row-level
-- security. Idempotent: DROP POLICY IF EXISTS; ALTER guarded by being inherently
-- idempotent. DEV/STAGING ONLY — never run in production, this re-opens the
-- cross-tenant breach that 0331 closed.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS tenant_isolation_users               ON users;
DROP POLICY IF EXISTS users_service_role_bypass            ON users;
ALTER TABLE users NO FORCE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_organizations       ON organizations;
DROP POLICY IF EXISTS organizations_service_role_bypass    ON organizations;
ALTER TABLE organizations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organizations DISABLE   ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_owner_skills        ON owner_skills;
DROP POLICY IF EXISTS owner_skills_service_role_bypass     ON owner_skills;
ALTER TABLE owner_skills NO FORCE ROW LEVEL SECURITY;
ALTER TABLE owner_skills DISABLE   ROW LEVEL SECURITY;

COMMIT;
