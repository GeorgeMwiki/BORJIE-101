-- =============================================================================
-- Migration 0358 — service-role bypass on the dark-worker READ-SOURCE tables
-- (closes the 0357 gap: the bypass was added to the workers' WRITE-TARGET
-- tables but NOT the tables they SCAN cross-tenant).
--
-- WHY THIS MIGRATION EXISTS
-- ------------------------
-- 0357 added `<tbl>_service_role_bypass` to the 5 write-target / own-source
-- tables (workforce_cert_expiry_reminders, regulatory_filings,
-- workforce_locations, entity_index, entity_cross_references). But two of the
-- four workers SCAN a DIFFERENT table than they write:
--   * ica-cert-expiry-cron  SELECTs FROM workforce_certifications  (writes cert_expiry_reminders)
--   * entity-indexer-worker SELECTs FROM licences / sites / document_drafts (writes entity_index)
-- Those source tables are FORCE-RLS with only a tenant-isolation policy on
-- `app.current_tenant_id` and NO service-role bypass, so even wrapped in
-- withServiceRoleContext (tenant='__system__' + is_service_role='true') the
-- cross-tenant scan matches ZERO rows — the worker is still dark on the READ
-- path. (compliance-deadline-scan reads regulatory_filings and geofence-watcher
-- reads workforce_locations — both their own write-targets, already covered by
-- 0357, so those two work.) This adds the bypass to the four read-source tables
-- so the scans actually return rows. The EXACT 0342/0354/0357 shape; existing
-- tenant-isolation policies untouched (permissive policies OR), request-path
-- reads unchanged.
--
-- FRESH-DB SAFETY / IDEMPOTENCY: every table to_regclass-guarded, each policy
-- pg_policies-guarded, FORCE re-asserted, guarded anon REVOKE. Pure RLS
-- metadata, no data touched. Immutable + forward-only.
--
-- Companion files:
--   * packages/database/src/migrations/0357_dark_worker_service_role_bypass.sql (write-targets)
--   * services/api-gateway/src/workers/ica-cert-expiry-cron.ts / entity-indexer-worker.ts
--   * packages/database/src/migrations/down/0358_down_dark_worker_source_table_bypass.sql
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'workforce_certifications',
    'licences',
    'sites',
    'document_drafts'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
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

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
