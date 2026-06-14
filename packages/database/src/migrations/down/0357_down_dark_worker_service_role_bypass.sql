-- =============================================================================
-- Down-migration 0357 — drop the dark-worker service-role bypass policies.
--
-- Dev/staging only. Reverses 0357 by dropping the five
-- `<tbl>_service_role_bypass` policies, reverting each table to
-- tenant-isolation-only RLS. WARNING: on a system whose cross-tenant workers
-- (ica-cert-expiry, compliance-deadline-scan, geofence-watcher, entity-indexer)
-- run over the service-role pool, this RE-DARKENS them — their scans will again
-- match zero rows under FORCE ROW LEVEL SECURITY. Pure RLS metadata — no data
-- touched, table-guarded + idempotent. Do not run against production.
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
    IF to_regclass('public.' || quote_ident(tbl)) IS NOT NULL THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON %I;',
        tbl || '_service_role_bypass', tbl
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
