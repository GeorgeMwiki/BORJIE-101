-- =============================================================================
-- Migration 0357 — service-role bypass on the DARK CROSS-TENANT WORKER tables
-- (the reminders-class dark-worker bug, again — the 0354 pattern for 5 tables).
--
-- WHY THIS MIGRATION EXISTS
-- ------------------------
-- Four background workers in services/api-gateway/src/workers/ scan + write
-- FORCE-RLS tenant-scoped tables CROSS-TENANT over the shared service-role
-- pool, which binds no per-request tenant GUC. Under FORCE ROW LEVEL SECURITY
-- the default pooled-connection state is `app.is_service_role='false'` + an
-- empty `app.current_tenant_id`, so the tenant-isolation predicate matches
-- ZERO rows and FORCE RLS FILTERS (rather than errors) — the workers ran
-- silently dark in production, exactly the class migration 0354 closed for
-- `reminders`:
--   * ica-cert-expiry-cron      -> workforce_cert_expiry_reminders
--   * compliance-deadline-scan  -> regulatory_filings
--   * geofence-watcher          -> workforce_locations
--   * entity-indexer-worker     -> entity_index, entity_cross_references
--
-- The workers are now wrapped in `withServiceRoleContext`
-- (packages/database/src/rls/with-tenant-context.ts), which binds
-- `app.is_service_role='true'`. This migration adds the matching
-- `<tbl>_service_role_bypass` policy (the EXACT 0342/0354 shape) to the five
-- tables that lacked one, so the bound context actually opens the rows. Each
-- table's EXISTING tenant-isolation policy is left UNTOUCHED — permissive
-- policies OR together, so request-path tenant isolation is unchanged.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every table guarded by
-- to_regclass; each policy is pg_policies-guarded; FORCE ROW LEVEL SECURITY is
-- RE-ASSERTED, never dropped; guarded anon REVOKE. Pure RLS metadata — no data
-- touched, no NOT-NULL/backfill/lock hazard. On a fully-migrated DB a re-run is
-- a pure no-op. Immutable once shipped — never edit this file; append a new one.
--
-- Companion files:
--   * services/api-gateway/src/workers/ica-cert-expiry-cron.ts (wrapped)
--   * services/api-gateway/src/workers/compliance-deadline-scan.worker.ts (wrapped)
--   * services/api-gateway/src/workers/geofence-watcher.ts (wrapped)
--   * services/api-gateway/src/workers/entity-indexer-worker.ts (wrapped)
--   * packages/database/src/migrations/0342_service_role_bypass_spine_tables.sql (the pattern)
--   * packages/database/src/migrations/0354_reminders_service_role_bypass.sql (prior fix)
--   * packages/database/src/migrations/down/0357_down_dark_worker_service_role_bypass.sql
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'workforce_cert_expiry_reminders',
    'regulatory_filings',
    'workforce_locations',
    'entity_index',
    'entity_cross_references'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Only act when the table exists on this DB (fresh-DB guard).
    IF to_regclass('public.' || quote_ident(tbl)) IS NULL THEN
      RAISE NOTICE '% absent — skipping service-role bypass (fresh-DB guard)', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

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

    -- Defense-in-depth: the anon role should never reach these tables.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
