-- =============================================================================
-- Migration 0336 — RLS closure for the 5 tenant-scoped tables that isolate on a
-- NON-`tenant_id` column (the reason the tenant_id-keyed RLS generators skipped
-- them; they were parked in the rls-coverage allowlist as tracked gaps).
--
-- WHY THIS MIGRATION EXISTS (CLAUDE.md hard rule)
-- ----------------------------------------------
-- "RLS is FORCE-enabled on every tenant-scoped table." A corrected RLS-coverage
-- scan (scripts/audit-rls-coverage.mjs — now loop/baseline-aware) proved the
-- repo's earlier "101 violations" were ~95% scanner blind-spots: every table
-- was already covered by a dynamic ENABLE/POLICY loop the scanner could not
-- statically resolve. The genuine residue is exactly these 5 tables, isolated
-- by a column OTHER than `tenant_id`:
--
--   platform_tenant_id  → org_memberships, invite_codes
--       (identity.schema.ts — the per-org join + invite tables carry the
--        canonical platform tenant id; compare to the GUC directly, TEXT = TEXT.)
--   organization_id     → geo_label_types, geo_nodes, geo_assignments
--       (geo.schema.ts — the per-org geo hierarchy has NO tenant_id, only
--        organization_id; isolate through the organization→tenant FK so a row
--        is visible iff its org belongs to the session tenant.)
--
-- A `*_service_role_bypass` policy (GUC `app.is_service_role='true'`) preserves
-- the legitimately-cross-tenant platform/service paths exactly as 0331 does.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule)
-- --------------------------------------------------
-- ENABLE/FORCE are idempotent by nature. Each table is guarded by a
-- `to_regclass(...)` existence check (skip-if-absent on a partial lex-order
-- apply; all 5 are created earlier by 0305 so a full apply skips none). Every
-- policy is created inside an `IF NOT EXISTS (SELECT 1 FROM pg_policies …)`
-- guard, so on an already-migrated DB this is a pure no-op. The anon REVOKE is
-- pg_roles-guarded so it applies on vanilla Postgres too.
--
-- Companion files:
--   * scripts/__allowlists__/rls-coverage-allowlist.mjs  (entries removed)
--   * packages/database/src/migrations/down/0336_down_rls_org_identity_geo_closure.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — platform_tenant_id-scoped: org_memberships, invite_codes.
--      Direct TEXT = TEXT comparison to the canonical GUC (like 0330/0331).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  platform_tenant_tables text[] := ARRAY['org_memberships', 'invite_codes'];
BEGIN
  FOREACH tbl IN ARRAY platform_tenant_tables LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = 'tenant_isolation_' || tbl
    ) THEN
      EXECUTE format($pol$
        CREATE POLICY %I ON public.%I FOR ALL
        USING      (platform_tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (platform_tenant_id = current_setting('app.current_tenant_id', true));
      $pol$, 'tenant_isolation_' || tbl, tbl);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = tbl || '_service_role_bypass'
    ) THEN
      EXECUTE format($pol$
        CREATE POLICY %I ON public.%I FOR ALL
        USING      (current_setting('app.is_service_role', true) = 'true')
        WITH CHECK (current_setting('app.is_service_role', true) = 'true');
      $pol$, tbl || '_service_role_bypass', tbl);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- §2 — organization_id-scoped geo hierarchy: geo_label_types, geo_nodes,
--      geo_assignments. No tenant_id column — isolate through the
--      organization→tenant FK: a row is visible iff its organization belongs to
--      the session tenant. The subquery is itself RLS-governed (organizations
--      carries tenant_isolation), so it can only ever resolve the session
--      tenant's own organizations — defence in depth.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  org_scoped_tables text[] := ARRAY['geo_label_types', 'geo_nodes', 'geo_assignments'];
BEGIN
  FOREACH tbl IN ARRAY org_scoped_tables LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = 'tenant_isolation_' || tbl
    ) THEN
      EXECUTE format($pol$
        CREATE POLICY %I ON public.%I FOR ALL
        USING (organization_id IN (
          SELECT id FROM organizations
           WHERE tenant_id = current_setting('app.current_tenant_id', true)
        ))
        WITH CHECK (organization_id IN (
          SELECT id FROM organizations
           WHERE tenant_id = current_setting('app.current_tenant_id', true)
        ));
      $pol$, 'tenant_isolation_' || tbl, tbl);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = tbl || '_service_role_bypass'
    ) THEN
      EXECUTE format($pol$
        CREATE POLICY %I ON public.%I FOR ALL
        USING      (current_setting('app.is_service_role', true) = 'true')
        WITH CHECK (current_setting('app.is_service_role', true) = 'true');
      $pol$, tbl || '_service_role_bypass', tbl);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
