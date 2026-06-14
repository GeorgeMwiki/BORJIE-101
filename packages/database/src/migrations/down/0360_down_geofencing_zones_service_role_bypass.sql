-- =============================================================================
-- Down-migration 0360 — drop the geofencing read-source bypass policy.
--
-- Dev/staging only. Reverts hazard_zones to tenant-isolation-only RLS. WARNING:
-- re-darkens the geofence-watcher's hazard scan (its cross-tenant
-- pointInHazard read again matches zero rows under FORCE RLS, so
-- worker_in_hazard_alert stops firing). Pure RLS metadata, no data touched,
-- table-guarded + idempotent. Not for production.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'hazard_zones'
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
