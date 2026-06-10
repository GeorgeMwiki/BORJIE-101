-- =============================================================================
-- Migration 0331 — CLOSE THE CROSS-TENANT BREACH on public.users,
-- public.organizations, owner_skills.
--
-- WHY THIS MIGRATION EXISTS (security-critical)
-- ---------------------------------------------
-- A deep DB audit found three tenant-scoped tables shipped with ZERO
-- row-level security — no ENABLE, no FORCE, no policy — while 358 FORCE-RLS
-- statements protect their siblings. `public.users` is the worst offender: it
-- holds `password_hash`, `mfa_secret`, `nida_id` (national ID), and
-- `biometric_template_hash`, isolated ONLY by app-layer `WHERE tenant_id = ?`
-- filters. A single SQL-injection, a forgotten WHERE, or any app bug would
-- spill every tenant's credentials + biometrics + national IDs across the
-- whole platform. This migration installs the DB-engine backstop the
-- CLAUDE.md hard rule "RLS is FORCE-enabled on every tenant-scoped table"
-- already mandates.
--
-- POLICY SHAPE — matches each table's tenant-key COLUMN TYPE
-- ---------------------------------------------------------
--   * users.tenant_id          TEXT (schemas/tenant.schema.ts)  — compare
--   * organizations.tenant_id  TEXT (schemas/tenant.schema.ts)  — directly,
--     no cast, EXACTLY like migration 0330 (set_point_state).
--   * owner_skills.installed_by_tenant_id  UUID NOT NULL
--     (schemas/owner-skills.schema.ts) — this is WHY the tenant_id-keyed RLS
--     generator skipped owner_skills: its isolation key is NOT named
--     `tenant_id`. We scope by `installed_by_tenant_id` and cast the GUC with
--     `NULLIF(...,'')::uuid` so an UNSET GUC (empty string) yields NULL — which
--     fails the equality safely instead of raising `invalid input syntax for
--     type uuid: ""`.
--
-- AUTH PRESERVATION (does NOT break login)
-- ----------------------------------------
-- The canonical Supabase sign-in path (composition/public-auth-wiring.ts)
-- calls Supabase's REST `/auth/v1/token` — it NEVER reads public.users, so RLS
-- here cannot affect it. The LEGACY direct-bcrypt login
-- (routes/auth.ts → resolveAuthUser) DOES a genuine cross-tenant
-- `LOWER(email)=LOWER(?)` lookup with NO tenant_id filter and NO bound GUC
-- (the user is not yet authenticated). Under FORCE RLS that query would return
-- zero rows and every legacy login would fail. The companion app-layer change
-- routes resolveAuthUser through `withServiceRoleContext` so the
-- `*_service_role_bypass` policy below (GUC `app.is_service_role='true'`)
-- short-circuits the tenant predicate for that one legitimately-cross-tenant
-- lookup. The bypass is GUC-driven, so it works regardless of the DB login
-- role's BYPASSRLS bit — no dependency on service_role privileges.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule)
-- --------------------------------------------------
-- ENABLE/FORCE are idempotent by nature. Every policy is created inside a
-- guarded `IF NOT EXISTS (SELECT 1 FROM pg_policies ...)` block; on a
-- fully-migrated DB this is a pure no-op. The anon REVOKE is wrapped in a
-- pg_roles guard. Mirrors migration 0330 exactly.
--
-- Companion files:
--   * services/api-gateway/src/routes/auth.ts        (withServiceRoleContext)
--   * services/api-gateway/src/routes/auth-mfa.ts     (withTenantContext)
--   * packages/database/src/__tests__/rls-coverage.test.ts
--   * packages/database/src/migrations/down/0331_down_rls_users_orgs_ownerskills.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- users + organizations — tenant_id is TEXT; compare to the GUC directly
-- (no cast), exactly like 0330. Service-role bypass installed so the
-- cross-tenant login lookup keeps working under withServiceRoleContext.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  text_key_tables text[] := ARRAY[
    'users',
    'organizations'
  ];
BEGIN
  FOREACH tbl IN ARRAY text_key_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = 'tenant_isolation_' || tbl
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        'tenant_isolation_' || tbl, tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_service_role_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
        || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
        tbl || '_service_role_bypass', tbl
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- owner_skills — isolation key is installed_by_tenant_id (UUID NOT NULL), NOT
-- tenant_id. Cast the GUC via NULLIF(...,'')::uuid so an UNSET GUC yields NULL
-- (fails closed) instead of raising on ''::uuid.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE owner_skills ENABLE ROW LEVEL SECURITY;
  ALTER TABLE owner_skills FORCE  ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_skills'
       AND policyname = 'tenant_isolation_owner_skills'
  ) THEN
    CREATE POLICY tenant_isolation_owner_skills ON owner_skills FOR ALL
      USING      (installed_by_tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (installed_by_tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_skills'
       AND policyname = 'owner_skills_service_role_bypass'
  ) THEN
    CREATE POLICY owner_skills_service_role_bypass ON owner_skills FOR ALL
      USING      (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.owner_skills FROM anon;
  END IF;
END $$;

COMMENT ON TABLE users IS
  'Tenant-scoped principals. FORCE RLS + tenant_isolation_users on app.current_tenant_id (migration 0331). Holds password_hash/mfa_secret/nida_id/biometric_template_hash — the DB-engine backstop here is what prevents a cross-tenant credential/biometric/national-ID spill if an app-layer WHERE filter is ever missed.';

COMMIT;
