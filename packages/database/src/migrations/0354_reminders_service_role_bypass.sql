-- =============================================================================
-- Migration 0354 — reminders: service-role bypass policy (closes a dark
-- cross-tenant worker, the reminders-side of the 0348 dispatch fix).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The `reminders` table (migration 0089) has FORCE ROW LEVEL SECURITY with a
-- single tenant-isolation policy on `current_setting('app.tenant_id', true)`
-- and NO service-role bypass — it was NOT included in 0342's spine-table
-- bypass list. But the reminders-dispatch worker drains reminders
-- CROSS-TENANT (one poll claims every tenant's due rows via FOR UPDATE SKIP
-- LOCKED) over the shared service-role pool, which binds no per-request
-- tenant GUC. Under FORCE RLS with no bypass, `tenant_id = ''` is false for
-- every row, so the claim matched ZERO rows in production and the entire
-- reminders loop (fire + the no-reminder-slips re-remind/escalate sweep) was
-- silently dark — exactly the false-green class 0348 closed for
-- notification_dispatch_log.
--
-- This adds the `reminders_service_role_bypass` policy (the EXACT 0342/0348
-- pattern) so the worker — wrapped in withServiceRoleContext, binding
-- `app.is_service_role='true'` — can claim + update across tenants, while the
-- request-path tenant-isolation policy still scopes every user-facing read.
-- RLS policies are OR'd (permissive), so the tenant-isolation policy is
-- unchanged and untouched for request traffic.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): table guarded by
-- to_regclass; the policy is pg_policies-guarded CREATE; re-run is a no-op.
-- Pure RLS metadata — no data touched, no NOT-NULL/backfill/lock hazard.
-- Immutable + forward-only.
--
-- Companion files:
--   * packages/database/src/migrations/0089_owner_reminders_and_tabs.sql (table + tenant policy)
--   * packages/database/src/migrations/0342_service_role_bypass_spine_tables.sql (the pattern)
--   * services/api-gateway/src/workers/reminders-dispatch.worker.ts (the wrapped worker)
--   * packages/database/src/migrations/down/0354_down_reminders_service_role_bypass.sql
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text := 'reminders';
BEGIN
  IF to_regclass('public.' || quote_ident(tbl)) IS NULL THEN
    RAISE NOTICE 'reminders table absent — skipping service-role bypass (fresh-DB guard)';
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
