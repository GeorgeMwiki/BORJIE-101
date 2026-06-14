-- =============================================================================
-- Migration 0360 — service-role bypass on the geofencing PREDICATE read-source
-- table the geofence-watcher reaches THROUGH the predicate service
-- (closes KI-014: 0357 covered the watcher's OWN workforce_locations scan and
-- 0358 covered sites/licences, but the downstream predicate service still hit
-- hazard_zones on a non-context-bound handle → 0 rows under FORCE RLS).
--
-- WHY THIS MIGRATION EXISTS
-- ------------------------
-- The geofence-watcher (services/api-gateway/src/workers/geofence-watcher.ts)
-- delegates its hazard / site / distance checks to the geofencing predicate
-- service (services/api-gateway/src/services/geofencing/predicates.ts). Those
-- predicates SELECT FROM:
--   * hazard_zones  (pointInHazard)            -> FORCE-RLS, tenant-isolation only, NO bypass  <-- THIS FILE
--   * sites         (pointInSite / distance)   -> bypass added by 0358
--   * licences      (pointInTitle)             -> bypass added by 0358
--   * regulatory_zones (pointInComplianceZone) -> tenant-AGNOSTIC, NO RLS (0130/0144) — nothing to add
-- Under FORCE ROW LEVEL SECURITY the shared service-role pool binds no
-- per-request tenant GUC, so the worker's cross-tenant hazard scan matched ZERO
-- rows and worker_in_hazard_alert never fired — even once the predicate calls
-- are wrapped in withServiceRoleContext (tenant='__system__' +
-- is_service_role='true'), hazard_zones had no policy that honours that GUC.
-- This adds the matching `hazard_zones_service_role_bypass` policy (the EXACT
-- 0342/0354/0357/0358 shape). The existing hazard_zones_tenant_isolation policy
-- is left UNTOUCHED — permissive policies OR together, so request-path tenant
-- isolation (geo brain tools, regulatory routes) is unchanged.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): the table is
-- to_regclass-guarded, the policy is pg_policies-guarded, FORCE ROW LEVEL
-- SECURITY is RE-ASSERTED (never dropped), guarded anon REVOKE. Pure RLS
-- metadata — no data touched, no NOT-NULL / backfill / lock hazard. On a
-- fully-migrated DB a re-run is a pure no-op. Immutable once shipped — never
-- edit this file; append a new one.
--
-- Companion files:
--   * services/api-gateway/src/workers/geofence-watcher.ts (wraps predicate calls)
--   * services/api-gateway/src/services/geofencing/predicates.ts (the scans)
--   * packages/database/src/migrations/0357_dark_worker_service_role_bypass.sql
--   * packages/database/src/migrations/0358_dark_worker_source_table_bypass.sql (sites/licences)
--   * packages/database/src/migrations/0130_postgis.sql (hazard_zones definition)
--   * packages/database/src/migrations/down/0360_down_geofencing_zones_service_role_bypass.sql
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

    -- Defense-in-depth: the anon role should never reach this table.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
