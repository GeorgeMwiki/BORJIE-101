-- =============================================================================
-- Migration 0342 — service-role bypass on the SELF-RUNNING-ORG SPINE tables
-- + two STRUCTURAL double-create guards (org_loop_runs / tab_event_log).
--
-- WHY THIS MIGRATION EXISTS (the RLS-dead flagship)
-- -------------------------------------------------
-- The org-loop spine runs OUT OF BAND (cron / reconcile sweep — no request
-- middleware binds the tenant GUC), so every spine read/write goes through
-- `withServiceRoleContext` (packages/database/src/rls/with-tenant-context.ts),
-- which binds tenant='__system__' + `app.is_service_role='true'`. That path
-- only works on tables that carry a `<tbl>_service_role_bypass` policy (the
-- 0321 / 0339 / 0341 shape). SEVEN spine tables have FORCE RLS + a tenant
-- policy but ZERO bypass policy — so on live FORCE-RLS Postgres every spine
-- access silently no-ops: the person-matcher reads 0 employees, dispatch
-- INSERTs into mining_tasks are denied, the tab_event_log proposal sink's
-- propose() always returns false, and the dispatch/audit logs never land.
-- The tenant predicate ('__system__' = tenant_id) matches nothing; FORCE RLS
-- filters rather than errors, so the failure is SILENT.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--   1. Adds the `<tbl>_service_role_bypass` policy (the EXACT 0341 policy
--      shape) to the 7 spine tables:
--        mining_tasks, employees, tasks, tab_event_log,
--        notification_dispatch_log, ai_audit_chain, mining_escalations.
--      Each table's EXISTING tenant-isolation policy is left untouched (this
--      migration deliberately does NOT add/replace tenant policies — adding a
--      second permissive tenant policy could broaden access); permissive
--      policies OR together, so request-path isolation is unchanged. FORCE
--      ROW LEVEL SECURITY is RE-ASSERTED, never dropped. The loop is guarded
--      per table on existence (the 0315 precedent): notification_dispatch_log
--      exists on live via schema-ahead drift but is not created by this chain,
--      so a fresh apply must no-op it instead of erroring.
--      NOTE on ai_audit_chain: the bypass grants ROW VISIBILITY only — the
--      append-only hard rule is enforced by the 0152/0332 triggers, which
--      block UPDATE/DELETE regardless of any policy.
--   2. STRUCTURAL GUARD A — at most ONE open/active org_loop_runs row per
--      (tenant_id, commitment_id): a partial unique index. The dispatcher's
--      SELECT-then-INSERT de-dupe read (findByCommitment) is racy under
--      concurrent ticks; the index makes double-create impossible at the
--      storage layer (the repository handles 23505 by adopting the winner).
--      Pre-existing open duplicates are honestly marked status='failed'
--      (keep the OLDEST — the canonical run) before the index is created.
--   3. STRUCTURAL GUARD B — at most ONE UNDELIVERED proactive_nudge row per
--      (tenant_id, proposal_id) in tab_event_log: a partial unique index
--      scoped to `event_kind='proactive_nudge' AND snapshot->>'delivered' is
--      not 'true'`. The estate-mind proposal sink SELECT-then-INSERTs on
--      proposal_id (estate-mind-wiring.ts createTabEventLogProposalSink);
--      its row ids embed proposedAtMs so the PK never dedupes a re-tick race.
--      Once `drainProactiveNudges` flips snapshot.delivered=true the row
--      LEAVES the partial index, so a legitimate RE-proposal (same drive-keyed
--      proposal_id, new row) after delivery still works. A plain unique on
--      (tenant_id, proposal_id) would break that re-proposal flow — hence
--      partial. Pre-existing pending duplicates are deleted keeping the NEWEST
--      (the sink refreshes the newest snapshot; older pendings are pure dupes).
--      The predicate uses the text-level `IS DISTINCT FROM 'true'` (immutable;
--      matches the sink's COALESCE((snapshot->>'delivered')::boolean,false)
--      semantics for missing / false / true).
--
-- TENANT SCOPE (CLAUDE.md hard rule): RLS FORCE stays ON everywhere; no
-- policy is dropped or weakened; the canonical `app.current_tenant_id` GUC
-- tenant-isolation path is untouched.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): pg_policies-guarded
-- CREATE POLICY, to_regclass existence guards, CREATE UNIQUE INDEX IF NOT
-- EXISTS, and dedupe DML that is a no-op when there are no duplicates. On a
-- fully-migrated DB a re-run is a pure no-op. The dedupe DML runs under the
-- transaction-local service-role GUCs set below so a NON-superuser migration
-- runner passes the FORCE-RLS policies created earlier in this transaction.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/repositories/org-loop-run-repository.ts (23505 adopt)
--   * services/api-gateway/src/composition/estate-mind-wiring.ts (the sink)
--   * packages/database/src/migrations/down/0342_down_service_role_bypass_spine_tables.sql
-- =============================================================================

BEGIN;

-- Transaction-local service-role context for the dedupe DML below (FORCE RLS
-- applies to table OWNERS too; a non-superuser runner needs the bypass).
SELECT set_config('app.current_tenant_id', '__system__', true);
SELECT set_config('app.is_service_role', 'true', true);

-- -----------------------------------------------------------------------------
-- 1. service_role_bypass on the 7 spine tables — the EXACT 0341 policy shape,
--    existence-guarded per table (0315 precedent). FORCE re-asserted; existing
--    tenant policies untouched; guarded anon REVOKE.
-- -----------------------------------------------------------------------------

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
    -- Only act when the table exists on this DB (notification_dispatch_log
    -- exists on live via drift but is not created by this migration chain).
    IF to_regclass('public.' || quote_ident(tbl)) IS NULL THEN
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

-- -----------------------------------------------------------------------------
-- 2. STRUCTURAL GUARD A — one open/active loop run per (tenant, commitment).
--    Dedupe first (keep the OLDEST open run — the canonical one; later
--    accidental double-creates are honestly marked 'failed'), then the index.
-- -----------------------------------------------------------------------------

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, commitment_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
    FROM org_loop_runs
   WHERE status IN ('open', 'active')
)
UPDATE org_loop_runs
   SET status = 'failed',
       updated_at = now()
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS org_loop_runs_open_commitment_uniq
  ON org_loop_runs (tenant_id, commitment_id)
  WHERE status IN ('open', 'active');

-- -----------------------------------------------------------------------------
-- 3. STRUCTURAL GUARD B — one UNDELIVERED proactive_nudge per
--    (tenant, proposal_id). Dedupe first (keep the NEWEST pending row — the
--    sink refreshes the newest snapshot), then the partial index. Delivered
--    rows leave the index, so re-proposal after delivery stays legal.
-- -----------------------------------------------------------------------------

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, proposal_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
    FROM tab_event_log
   WHERE event_kind = 'proactive_nudge'
     AND proposal_id IS NOT NULL
     AND (snapshot ->> 'delivered') IS DISTINCT FROM 'true'
)
DELETE FROM tab_event_log
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS tab_event_log_pending_nudge_uniq
  ON tab_event_log (tenant_id, proposal_id)
  WHERE event_kind = 'proactive_nudge'
    AND (snapshot ->> 'delivered') IS DISTINCT FROM 'true';

COMMIT;
