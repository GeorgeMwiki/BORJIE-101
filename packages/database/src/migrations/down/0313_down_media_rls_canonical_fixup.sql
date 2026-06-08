-- =============================================================================
-- DOWN 0313 — reverse media RLS canonical fixup.   DEV/STAGING ONLY.
--
-- Reverses 0313_media_rls_canonical_fixup.sql: drops the canonical
-- `<table>_tenant_isolation` + `<table>_service_role_bypass` policies, removes
-- FORCE (back to ENABLE-only), and restores the original (intentionally
-- defective) `tenant_isolation` policy exactly as 0020_media_generation.sql
-- shipped it — bound to the non-canonical `app.tenant_id` GUC.
--
-- WARNING: running this DOWN re-opens the tenant-isolation gap that 0313
-- closes. It exists only so dev/staging can faithfully roll back to the
-- pre-0313 schema state. NEVER run in production. No data is touched.
--
-- Idempotent: DROP POLICY IF EXISTS + ENABLE/NO FORCE are re-runnable.
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
    -- Drop the canonical policies added by 0313.
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I;', t || '_tenant_isolation', t
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I;', t || '_service_role_bypass', t
    );

    -- Remove FORCE (restore ENABLE-only as 0020 shipped it).
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    -- Restore the original (defective) policy verbatim from 0020.
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

COMMIT;
