-- =============================================================================
-- Down-migration 0342 — reverse service_role_bypass_spine_tables.
--
-- Dev/staging only. Drops the `<tbl>_service_role_bypass` policies from the 7
-- self-running-org spine tables and the two structural double-create guard
-- indexes. The fail-safe consequence: the out-of-band org-loop spine
-- (withServiceRoleContext — tenant='__system__' + app.is_service_role='true')
-- silently no-ops against these FORCE-RLS tables again (the pre-0342 RLS-dead
-- state): the person-matcher reads 0 employees, dispatch INSERTs into
-- mining_tasks are denied, the tab_event_log proposal sink's propose() returns
-- false. Request-path tenant isolation is UNAFFECTED (each table's own
-- tenant-isolation policy + FORCE RLS survive untouched). Dropping the guard
-- indexes re-permits concurrent double-creates (open org_loop_runs duplicates
-- per commitment; duplicate pending proactive_nudge rows per proposal_id).
--
-- NOT restored (the up-migration's one-time dedupe was lossy by design):
-- open-duplicate org_loop_runs rows marked 'failed' stay 'failed'; deleted
-- duplicate pending tab_event_log nudge rows stay deleted. No money/licence/
-- ledger records live in either. Dev/staging rollback only.
--
-- Reverses migration 0342_service_role_bypass_spine_tables.sql.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'mining_tasks',
    'employees',
    'tasks',
    'tab_event_log',
    'notification_dispatch_log',
    'ai_audit_chain',
    'mining_escalations'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || quote_ident(tbl)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I;',
      tbl || '_service_role_bypass', tbl
    );
  END LOOP;
END $$;

DROP INDEX IF EXISTS org_loop_runs_open_commitment_uniq;
DROP INDEX IF EXISTS tab_event_log_pending_nudge_uniq;

COMMIT;
