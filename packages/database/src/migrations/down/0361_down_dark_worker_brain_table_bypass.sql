-- =============================================================================
-- Down-migration 0361 — drop the dark-worker brain/owner bypass policies.
--
-- Dev/staging only. Reverts owner_contact_prefs / decisions / decision_outcomes
-- / outcome_observations / outcome_reconciliations / outcome_predictions /
-- executive_brief_actions / licence_events to tenant-isolation-only RLS.
-- WARNING: re-darkens the cross-tenant scans of announcement-recipient-resolver,
-- decision-retrospective-worker, outcome-reconciliation-worker,
-- executive-brief-action-runner and licence-renewal-watcher (their scans again
-- match zero rows under FORCE RLS). Pure RLS metadata, no data touched,
-- table-guarded + idempotent. Not for production.
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
    IF to_regclass('public.' || quote_ident(tbl)) IS NOT NULL THEN
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON %I;',
        tbl || '_service_role_bypass', tbl
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
