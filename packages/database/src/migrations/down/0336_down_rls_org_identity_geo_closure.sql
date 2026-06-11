-- =============================================================================
-- DOWN 0336 — reverse the org/identity/geo RLS closure.
--
-- Drops the two policies installed per table and disables RLS, restoring the
-- pre-0336 state (the tables were ENABLE/FORCE/policy-free). Idempotent:
-- DROP POLICY IF EXISTS + a to_regclass guard, so re-running is a no-op.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
  all_tables text[] := ARRAY[
    'org_memberships', 'invite_codes',
    'geo_label_types', 'geo_nodes', 'geo_assignments'
  ];
BEGIN
  FOREACH tbl IN ARRAY all_tables LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', 'tenant_isolation_' || tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_service_role_bypass', tbl);
    EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', tbl);
  END LOOP;
END $$;

COMMIT;
