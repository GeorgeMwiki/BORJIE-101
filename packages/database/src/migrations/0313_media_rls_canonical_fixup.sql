-- =============================================================================
-- Migration 0313 — media RLS canonical fixup
--                  (media_artifacts, media_safety_scans, media_engagement_events).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Migration 0020_media_generation.sql (a drizzle baseline file) shipped a
-- real TENANT-ISOLATION DEFECT on its three tenant-scoped media tables:
--
--   * it used `ENABLE` (not `FORCE`) ROW LEVEL SECURITY — so the table OWNER
--     / a superuser bypasses RLS entirely; and
--   * its `tenant_isolation` policy bound the NON-canonical GUC
--     `app.tenant_id`, which the api-gateway middleware never sets. The
--     canonical tenant GUC is `app.current_tenant_id` everywhere else in the
--     codebase (see packages/storage-adapter/src/types.ts:31 and every other
--     RLS migration, e.g. 0309_cognitive_memory_audit_chain.sql:82-122). A
--     policy keyed on an unset GUC compares `tenant_id = NULL` → NULL →
--     effectively a no-op: it does NOT isolate tenants, and (the original had
--     no explicit WITH CHECK so USING doubled as the check) it does not bind
--     writes to a real tenant either.
--
-- Net effect on prod: these three tables are NOT FORCE-RLS and their policy
-- references a GUC the gateway never binds — a genuine cross-tenant exposure
-- surface. Migrations are immutable (CLAUDE.md hard rail), so 0020 is left
-- untouched and this forward-only migration repairs the live state.
--
-- WHAT IT DOES (mirrors the canonical 0309 shape)
-- -----------------------------------------------
--   (1) FORCE ROW LEVEL SECURITY on all three tables — the owner can no
--       longer bypass RLS.
--   (2) DROP the defective `tenant_isolation` policy and CREATE
--       `<table>_tenant_isolation` with USING + WITH CHECK on the canonical
--       `app.current_tenant_id` GUC — so reads AND writes are tenant-bound.
--   (3) CREATE `<table>_service_role_bypass` so the composition root's system
--       reads (withServiceRoleContext → app.is_service_role='true') are
--       permitted, matching 0308/0309.
--
-- IDEMPOTENT / FRESH-DB SAFE (CLAUDE.md hard rail)
-- ------------------------------------------------
-- ENABLE/FORCE are no-ops on re-run; every policy is DROP POLICY IF EXISTS
-- then CREATE; the anon REVOKE is guarded by an INLINE pg_roles check — NOT a
-- block-level EXCEPTION handler (a block-level EXCEPTION around this loop
-- would roll the whole DO block back and silently drop FORCE+policies on a DB
-- with no `anon` role). Pure no-op on an already-fixed DB. No data touched.
--
-- Companion: down/0313_down_media_rls_canonical_fixup.sql (dev/staging only).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'media_artifacts',
    'media_safety_scans',
    'media_engagement_events'
  ]
  LOOP
    -- (1) FORCE RLS — owner/superuser can no longer bypass tenant isolation.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE public.%I FORCE  ROW LEVEL SECURITY;', t);

    -- (2) Replace the defective policy (wrong GUC, no real WITH CHECK) with
    --     the canonical tenant-isolation policy on app.current_tenant_id.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I;', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I;', t || '_tenant_isolation', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I '
      'FOR ALL '
      'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
      'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
      t || '_tenant_isolation', t
    );

    -- (3) Service-role bypass for composition-root system reads.
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I;', t || '_service_role_bypass', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I '
      'FOR ALL '
      'USING (current_setting(''app.is_service_role'', true) = ''true'') '
      'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
      t || '_service_role_bypass', t
    );

    -- Lock down anon (Supabase-only; INLINE guard, never a block EXCEPTION).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', t);
    END IF;
  END LOOP;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0313_media_rls_canonical_fixup.sql
-- =============================================================================
