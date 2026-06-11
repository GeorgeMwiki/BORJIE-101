-- =============================================================================
-- Down-migration 0347 — remove FORCE RLS + the service-role policy from
-- tenant_identities (revert to the pre-0347 no-RLS posture).
--
-- Dev/staging only. This REOPENS the cross-tenant PII exposure 0347 closed —
-- only for a clean apply→reverse test. NO data is touched (RLS is metadata).
--
-- Reverses migration 0347_rls_tenant_identities_closure.sql.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tenant_identities') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS tenant_identities_service_role_bypass ON public.tenant_identities';
  EXECUTE 'ALTER TABLE public.tenant_identities NO FORCE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE public.tenant_identities DISABLE ROW LEVEL SECURITY';
END $$;

COMMENT ON TABLE tenant_identities IS NULL;

COMMIT;
