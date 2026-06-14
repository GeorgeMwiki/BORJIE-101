-- =============================================================================
-- Migration 0361 — service-role bypass on the dark-worker brain/owner tables
-- (closes the 8-worker darkness recurrence found by the live-readiness audit on
-- 2026-06-14 after the v25 deploy; companion to 0342/0354/0357/0358/0360).
--
-- WHY THIS MIGRATION EXISTS
-- ------------------------
-- Eight more background workers were scanning FORCE-RLS tenant tables
-- cross-tenant over the shared service pool with NO context binding, so RLS
-- filtered every scan to ZERO rows in prod while code / typecheck / unit-tests
-- stayed green (the same reminders-class darkness 0354 fixed). The worker code
-- is now wrapped in withServiceRoleContext (cross-tenant scans) or
-- withWorkerTenantContext (per-tenant legs). This migration adds the
-- `<tbl>_service_role_bypass` policy that the withServiceRoleContext path needs
-- on the tables those workers scan CROSS-TENANT — without it the scan still
-- matches zero rows even with app.is_service_role='true' bound.
--
-- Worker -> cross-tenant table mapping (verified file:line in the audit):
--   * announcement-recipient-resolver  -> owner_contact_prefs   (users already 0331)
--   * decision-retrospective-worker     -> decisions, decision_outcomes,
--                                          outcome_observations, outcome_reconciliations
--   * outcome-reconciliation-worker     -> outcome_predictions, outcome_reconciliations,
--                                          outcome_observations
--   * executive-brief-action-runner     -> executive_brief_actions
--   * licence-renewal-watcher           -> licence_events        (licences already 0358)
--
-- Per-tenant legs (daily-brief-cron, mwikila-autonomous, proactive-intel) bind
-- withWorkerTenantContext and are satisfied by the existing tenant-isolation
-- policies under EITHER GUC name, so they need NO new policy here.
--
-- Ground truth (queried on prod 2026-06-14): all eight tables are
-- relrowsecurity=t, relforcerowsecurity=t, and had NO *_service_role_bypass
-- policy before this migration.
--
-- FRESH-DB SAFETY / IDEMPOTENCY: every table to_regclass-guarded, each policy
-- pg_policies-guarded, FORCE re-asserted, guarded anon REVOKE. Pure RLS
-- metadata, no data touched. The bypass fires ONLY when app.is_service_role is
-- explicitly bound to 'true' (worker-only path), so request-path reads and the
-- existing permissive tenant-isolation policies are unchanged (policies OR).
-- Immutable + forward-only.
--
-- Companion files:
--   * services/api-gateway/src/workers/{announcement-recipient-resolver,
--     decision-retrospective-worker,outcome-reconciliation-worker,
--     executive-brief-action-runner,licence-renewal-watcher}.ts
--   * packages/database/src/migrations/down/0361_down_dark_worker_brain_table_bypass.sql
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'owner_contact_prefs',
    'decisions',
    'decision_outcomes',
    'outcome_observations',
    'outcome_reconciliations',
    'outcome_predictions',
    'executive_brief_actions',
    'licence_events'
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
