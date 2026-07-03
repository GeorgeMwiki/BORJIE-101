-- =============================================================================
-- Migration 0376 — event_outbox: service-role bypass policy (closes a latent
-- dark cross-tenant money worker — the settlement-drain side of the 0354 fix).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The `event_outbox` table (migration 0305) has ENABLE + FORCE ROW LEVEL
-- SECURITY with a SINGLE tenant-isolation policy —
--   USING (tenant_id = current_setting('app.current_tenant_id', true))
-- — and NO service-role bypass (it was not in 0342's spine-table list, nor
-- added by 0354/0357/0358/0361/0365). But the settlement-drain worker
-- (services/api-gateway/src/workers/settlement-drain.worker.ts) drains
-- `event_outbox WHERE event_type='settlement.requested'` CROSS-TENANT over the
-- shared service-role pool, wrapped in withServiceRoleContext — which, under
-- FORCE RLS (`BORJIE_ENFORCE_RLS=true`), issues `SET LOCAL ROLE authenticated`
-- (rolbypassrls=f) and binds tenant='__system__'. With only the tenant-isolation
-- policy, `tenant_id = '__system__'` is false for every real row, so the pick /
-- CAS-claim / mark statements match ZERO rows and the entire OFFTAKE SETTLEMENT
-- MONEY LEG goes silently dark — the exact false-green class 0354 closed for the
-- reminders-dispatch worker and 0348 for notification_dispatch_log.
--
-- The enforcement flag is designed to flip WITHOUT a redeploy, so today's
-- inert-RLS prod (gateway role rolbypassrls=t) is not proof of safety: the
-- moment RLS is enforced, an un-migrated event_outbox re-darkens the money
-- worker. This adds the `event_outbox_service_role_bypass` policy (the EXACT
-- 0342/0348/0354 pattern) so the service-role-wrapped worker — binding
-- app.is_service_role='true' — can pick/claim/mark across tenants, while the
-- request-path tenant-isolation policy still scopes every user-facing access.
-- RLS policies are OR'd (permissive), so the tenant-isolation policy is
-- unchanged and untouched for request traffic.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): table guarded by
-- to_regclass; the policy is pg_policies-guarded CREATE; re-run is a no-op.
-- Pure RLS metadata — no data touched, no NOT-NULL/backfill/lock hazard.
-- Immutable + forward-only.
--
-- Companion files:
--   * packages/database/src/migrations/0305_create_missing_schema_tables.sql (table + tenant policy)
--   * packages/database/src/migrations/0354_reminders_service_role_bypass.sql (the reminders precedent)
--   * services/api-gateway/src/workers/settlement-drain.worker.ts (the wrapped worker)
--   * packages/database/src/migrations/down/0376_down_event_outbox_service_role_bypass.sql
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text := 'event_outbox';
BEGIN
  IF to_regclass('public.' || quote_ident(tbl)) IS NULL THEN
    RAISE NOTICE 'event_outbox table absent — skipping service-role bypass (fresh-DB guard)';
    RETURN;
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
END $$;

COMMIT;
