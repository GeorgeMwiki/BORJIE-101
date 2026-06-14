-- =============================================================================
-- Down-migration 0358 — drop the dark-worker read-source bypass policies.
--
-- Dev/staging only. Reverts workforce_certifications / licences / sites /
-- document_drafts to tenant-isolation-only RLS. WARNING: re-darkens the READ
-- path of ica-cert-expiry-cron + entity-indexer-worker (their cross-tenant
-- scans again match zero rows under FORCE RLS). Pure RLS metadata, no data
-- touched, table-guarded + idempotent. Not for production.
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
    IF to_regclass('public.' || quote_ident(tbl)) IS NOT NULL THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON %I;',
        tbl || '_service_role_bypass', tbl
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
