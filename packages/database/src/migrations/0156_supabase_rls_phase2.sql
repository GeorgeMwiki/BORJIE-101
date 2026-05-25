-- Phase D / A2b-1, 2026-05-18 — Row-Level-Security phase 2.
--
-- Extends 0155 by:
--   1. Adding RLS coverage to a further ~13 tenant-scoped tables that
--      0155 explicitly deferred (sovereign_action_ledger,
--      agency_run_checkpoints, voice_turns, doc_chat_*, kernel_memory_*,
--      reflexion_buffer, document_embeddings, intelligence_history,
--      tenant_financial_statements, tenant_litigation_history,
--      sensor_call_log).
--   2. Adding `FORCE ROW LEVEL SECURITY` to EVERY RLS-enabled table —
--      both the new tables here AND the existing 25 tables from 0155.
--      Without FORCE, the table owner role (typically `postgres` or
--      the Supabase service role) bypasses the policy entirely. This
--      is the "RLS is a Maginot Line" fix from the user-data-gaps
--      audit (HIGH).
--
-- Strategy mirrors 0155: a single `DO $$ ... $$;` block walks the
-- table list, gates on `information_schema.tables` existence (so the
-- migration is idempotent for shards where a feature-flag table has
-- not been created yet), and uses the same `current_app_tenant_id()`
-- helper that 0155 defined.
--
-- HISTORICAL NOTE (closed by migration 0172, Supabase audit F2,
-- 2026-05-21): when this migration shipped, `current_app_tenant_id()`
-- read the `app.tenant_id` GUC while the gateway middleware set
-- `app.current_tenant_id` — a silent mismatch that caused every
-- policy below to evaluate to NULL = NULL (FALSE) for authenticated
-- requests. Migration 0172 redefines `current_app_tenant_id()` to
-- read the gateway's canonical name (with a back-compat fallback to
-- `app.tenant_id`), unifying both halves of the system on a single
-- GUC name without altering this migration's policy DDL.

-- ============================================================================
-- 1. New tenant-scoped tables — enable RLS + install tenant-isolation policy
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables_phase2 text[] := ARRAY[
    'voice_turns',
    'doc_chat_sessions',
    'doc_chat_messages',
    'document_embeddings',
    'reflexion_buffer',
    'kernel_memory_episodic',
    'kernel_memory_semantic',
    'kernel_memory_procedural',
    'kernel_memory_reflective',
    'agency_run_checkpoints',
    'sovereign_action_ledger',
    'tenant_financial_statements',
    'tenant_litigation_history',
    'intelligence_history',
    'sensor_call_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables_phase2 LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = tbl
    ) THEN
      -- Enable RLS (idempotent if already enabled).
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);

      -- Drop pre-existing policies with our canonical name so the
      -- migration is replayable.
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Revoke anon access.
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 2. FORCE RLS on every RLS-enabled table — both 0155 and 0156 tables.
-- ============================================================================
-- Without FORCE, the table owner role (postgres / service_role) BYPASSES
-- the policy. With FORCE, every connection (including owners) is
-- subject to the policy. The Supabase `service_role` connection that
-- the gateway uses for cross-tenant ops continues to BYPASSRLS at the
-- ROLE level (a different mechanism); FORCE only affects the table-
-- owner bypass and tightens the security posture for everyone else.

DO $$
DECLARE
  tbl text;
  all_rls_tables text[] := ARRAY[
    -- 0155 set (25 tables)
    'customers',
    'leases',
    'ledger_entries',
    'invoices',
    'maintenance_requests',
    'audit_events',
    'documents',
    'payments',
    'properties',
    'units',
    'expenses',
    'vendors',
    'work_orders',
    'inspections',
    'communications',
    'blocks',
    'asset_components',
    'cases',
    'feedback_complaints',
    'compliance_exports',
    'conditional_survey',
    'kernel_decision_ledger',
    'ai_audit_chain',
    'ai_cost',
    'approval_policy',
    -- 0156 phase-2 set
    'voice_turns',
    'doc_chat_sessions',
    'doc_chat_messages',
    'document_embeddings',
    'reflexion_buffer',
    'kernel_memory_episodic',
    'kernel_memory_semantic',
    'kernel_memory_procedural',
    'kernel_memory_reflective',
    'agency_run_checkpoints',
    'sovereign_action_ledger',
    'tenant_financial_statements',
    'tenant_litigation_history',
    'intelligence_history',
    'sensor_call_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY all_rls_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 3. Sanity-check note for operators.
-- ============================================================================
-- After this migration runs, `SELECT * FROM public.rls_coverage_audit;`
-- (view defined in 0155) should show `rls_forced = true` for every row
-- listed above. The same view's `policy_count >= 2` invariant still
-- holds for the phase-2 tables.
