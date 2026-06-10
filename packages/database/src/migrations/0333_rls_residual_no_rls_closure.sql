-- =============================================================================
-- Migration 0333 — CLOSE THE RESIDUAL CROSS-TENANT BREACH on the 9 tenant-scoped
-- tables that still shipped with ZERO row-level security (no ENABLE, no FORCE,
-- no policy), the same high-severity breach class migration 0331 closed for
-- users/organizations/owner_skills. The static RLS-coverage guard
-- (packages/database/src/__tests__/rls-coverage.test.ts) enumerated them in
-- RLS_NO_RLS_KNOWN_DEBT; this migration drives that registry to EMPTY.
--
-- WHY THIS MIGRATION EXISTS (security-critical)
-- ---------------------------------------------
-- Each of these tables declares a `*tenant_id` column but was isolated ONLY by
-- app-layer `WHERE tenant_id = ?` filters. A single missed WHERE, a SQL
-- injection, or any app bug would spill rows across tenants. This installs the
-- DB-engine backstop the CLAUDE.md hard rule "RLS is FORCE-enabled on every
-- tenant-scoped table" already mandates. Mirrors migration 0331 EXACTLY:
-- ENABLE + FORCE, a guarded `tenant_isolation_<t>` policy, a
-- `<t>_service_role_bypass` policy, and a guarded anon REVOKE.
--
-- POLICY SHAPE — matched to each table's ACTUAL tenant-key COLUMN + TYPE
-- --------------------------------------------------------------------
--  TEXT key, NOT NULL   → compare directly to the GUC, no cast (like 0330/0331)
--  TEXT key, NULLABLE   → `(<col> IS NULL OR <col> = <guc>)` so legitimately
--                         GLOBAL (NULL-tenant) rows STAY VISIBLE — a naive
--                         equality would HIDE every global row (the trap).
--  UUID key, NULLABLE   → `(<col> IS NULL OR <col> = NULLIF(<guc>,'')::uuid)`
--                         — same global-row preservation, plus the NULLIF cast
--                         so an UNSET GUC (empty string) yields NULL instead of
--                         raising `invalid input syntax for type uuid: ""`.
--  UUID key, NOT NULL   → `<col> = NULLIF(<guc>,'')::uuid` (person_links — see
--                         the AUTH-ADJACENT note below).
--
-- THE 9 TABLES + their confirmed tenant key (read from the CREATE TABLE DDL):
--   person_links            tenant_id          UUID NOT NULL  (auth-adjacent)
--   personal_memory_cells   source_tenant_id   UUID NULL      (nullable→global)
--   org_memberships         platform_tenant_id TEXT NOT NULL
--   invite_codes            platform_tenant_id TEXT NOT NULL
--   cross_tenant_denials    caller_tenant_id   TEXT NOT NULL  (cross-tenant log)
--   daily_revival_counters  tenant_id          TEXT NULL      (NULL=platform agg)
--   wave_progress           tenant_id          TEXT NULL      (NULL=platform)
--   learning_observations   tenant_id          TEXT NULL      (NULL=global)
--   ab_experiments          tenant_id          TEXT NULL      (NULL=fleet-wide)
--
-- person_links — AUTH-ADJACENT, the highest-priority one.
-- -----------------------------------------------------
-- services/api-gateway/src/routes/me-tenants.hono.ts queries person_links by
-- `supabase_user_id` to power the Discord-style "hat-switching" tenant rail
-- (GET /api/v1/me/tenants) and to re-verify a switch (POST .../active). That
-- lookup is INHERENTLY CROSS-TENANT: it must return EVERY tenant the user is
-- linked to, and it runs while `app.current_tenant_id` is still bound to the
-- user's CURRENTLY-active tenant. A naive `tenant_id = <guc>` policy would
-- return only links for the active tenant — hiding all the OTHER hats and
-- breaking the rail. FIX (companion app change, approach (i)): those two
-- lookups now run inside `withServiceRoleContext(db, ...)`, which sets
-- `app.is_service_role='true'` transaction-locally, so the
-- `person_links_service_role_bypass` policy below short-circuits the tenant
-- predicate for exactly that legitimately-cross-tenant read — while every
-- ordinary query stays scoped by `tenant_isolation_person_links`. The bypass
-- is GUC-driven, independent of the DB login role's BYPASSRLS bit.
--
-- cross_tenant_denials — cross-tenant BY NAME, single-tenant BY ACCESS.
-- -------------------------------------------------------------------
-- This is the security-denial audit log. `caller_tenant_id` (NOT NULL) is the
-- tenant whose request was denied; `foreign_tenant_id` is the tenant they tried
-- to reach. The ROW belongs to the CALLER — an owner should only ever read
-- their OWN denial history, never another tenant's. So isolation keys on
-- `caller_tenant_id`, exactly like any other tenant table; there is no
-- legitimate cross-tenant READ of this log from app code. Cross-tenant INSERTs
-- by the platform's own denial recorder run under service-role (the bypass
-- policy), so the recorder is never blocked.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule)
-- --------------------------------------------------
-- ENABLE/FORCE are idempotent by nature. Every policy is created inside a
-- guarded `IF NOT EXISTS (SELECT 1 FROM pg_policies ...)` block; on a
-- fully-migrated DB this is a pure no-op. Each anon REVOKE is wrapped in a
-- pg_roles guard. Mirrors migration 0331 exactly.
--
-- Companion files:
--   * services/api-gateway/src/routes/me-tenants.hono.ts (withServiceRoleContext)
--   * packages/database/src/__tests__/rls-coverage.test.ts (registry → empty)
--   * packages/database/src/migrations/down/0333_down_rls_residual_no_rls_closure.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- GROUP 1 — TEXT tenant key, NOT NULL: compare to the GUC directly (no cast),
-- exactly like 0331's users/organizations. A service-role bypass is installed
-- on each so legitimate cross-tenant system writes/reads keep working.
--   org_memberships       → platform_tenant_id
--   invite_codes          → platform_tenant_id
--   cross_tenant_denials  → caller_tenant_id
-- The isolation column differs per table, so we drive a (table, column) map.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  text_notnull_tables CONSTANT text[][] := ARRAY[
    ARRAY['org_memberships',      'platform_tenant_id'],
    ARRAY['invite_codes',         'platform_tenant_id'],
    ARRAY['cross_tenant_denials', 'caller_tenant_id']
  ];
  i int;
  tbl text;
  col text;
BEGIN
  FOR i IN 1 .. array_length(text_notnull_tables, 1) LOOP
    tbl := text_notnull_tables[i][1];
    col := text_notnull_tables[i][2];

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
        || 'USING (%I = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (%I = current_setting(''app.current_tenant_id'', true));',
        'tenant_isolation_' || tbl, tbl, col, col
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
-- GROUP 2 — TEXT tenant key, NULLABLE: `(<col> IS NULL OR <col> = <guc>)` so
-- legitimately-global (NULL-tenant) rows STAY VISIBLE to every tenant while
-- tenant-owned rows are scoped. A naive equality would HIDE every global row.
--   daily_revival_counters → tenant_id  (NULL = platform-wide aggregate)
--   wave_progress          → tenant_id  (NULL = platform orchestration)
--   learning_observations  → tenant_id  (NULL = global observation)
--   ab_experiments         → tenant_id  (NULL = fleet-wide experiment)
-- All four use the column name `tenant_id`, so a simple array drives them.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  nullable_text_tables text[] := ARRAY[
    'daily_revival_counters',
    'wave_progress',
    'learning_observations',
    'ab_experiments'
  ];
BEGIN
  FOREACH tbl IN ARRAY nullable_text_tables LOOP
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
        || 'USING (tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true));',
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
-- GROUP 3 — personal_memory_cells: source_tenant_id is UUID NULL. Federated by
-- design (mirrors platform_memory_cells) — SOME cells are legitimately global
-- (source_tenant_id IS NULL = no single owning tenant). Nullable-UUID predicate:
--   (source_tenant_id IS NULL OR source_tenant_id = NULLIF(<guc>,'')::uuid)
-- The IS NULL branch keeps global cells visible; the NULLIF cast makes an UNSET
-- GUC yield NULL (so tenant cells fail closed) instead of raising on ''::uuid.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE personal_memory_cells ENABLE ROW LEVEL SECURITY;
  ALTER TABLE personal_memory_cells FORCE  ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'personal_memory_cells'
       AND policyname = 'tenant_isolation_personal_memory_cells'
  ) THEN
    CREATE POLICY tenant_isolation_personal_memory_cells ON personal_memory_cells FOR ALL
      USING      (source_tenant_id IS NULL OR source_tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (source_tenant_id IS NULL OR source_tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'personal_memory_cells'
       AND policyname = 'personal_memory_cells_service_role_bypass'
  ) THEN
    CREATE POLICY personal_memory_cells_service_role_bypass ON personal_memory_cells FOR ALL
      USING      (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.personal_memory_cells FROM anon;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- GROUP 4 — person_links: tenant_id is UUID NOT NULL (AUTH-ADJACENT). Scope by
-- tenant_id with the NULLIF(...,'')::uuid cast (UNSET GUC → NULL → fails closed
-- instead of raising on ''::uuid), EXACTLY like 0331's owner_skills. The
-- hat-switching rail's cross-tenant reads run under withServiceRoleContext, so
-- the service_role_bypass policy below short-circuits the tenant predicate for
-- that one legitimately-cross-tenant lookup; every ordinary query stays scoped.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE person_links ENABLE ROW LEVEL SECURITY;
  ALTER TABLE person_links FORCE  ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'person_links'
       AND policyname = 'tenant_isolation_person_links'
  ) THEN
    CREATE POLICY tenant_isolation_person_links ON person_links FOR ALL
      USING      (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'person_links'
       AND policyname = 'person_links_service_role_bypass'
  ) THEN
    CREATE POLICY person_links_service_role_bypass ON person_links FOR ALL
      USING      (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.person_links FROM anon;
  END IF;
END $$;

COMMENT ON TABLE person_links IS
  'Auth-adjacent tenant-membership links (supabase_user_id ↔ tenant_id). FORCE RLS + tenant_isolation_person_links on app.current_tenant_id (migration 0333). The me-tenants hat-switching rail reads this CROSS-tenant under withServiceRoleContext so the service-role-bypass policy keeps multi-hat switching working while ordinary queries stay tenant-scoped.';

COMMENT ON TABLE cross_tenant_denials IS
  'Security cross-tenant denial audit log. FORCE RLS + tenant_isolation_cross_tenant_denials on caller_tenant_id (migration 0333): an owner reads only their OWN denial history; the platform denial recorder inserts cross-tenant under service-role. Despite the name, no legitimate cross-tenant READ from app code.';

COMMIT;
