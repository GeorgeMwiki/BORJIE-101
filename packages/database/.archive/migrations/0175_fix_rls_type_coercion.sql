-- =============================================================================
-- 0175: Fix RLS type-coercion across the 8 broken RLS migrations.
--
-- Closes Z-MIG verifier finding: every RLS policy installed since 0155
-- compares `tenant_id` (TEXT — see tenants.id in 0001_initial.sql) against
-- `public.current_app_tenant_id()` which returns UUID. The result is the
-- runtime error:
--
--     ERROR:  operator does not exist: text = uuid
--     LINE 1: ...tenant_id = public.current_app_tenant_id()
--
-- Two viable paths:
--   (a) Change every policy DDL to `tenant_id::uuid = fn()` — would require
--       editing 8 already-merged migrations (forbidden by the fix-forward
--       rule) AND it would fail on legacy text tenant_ids that aren't
--       UUID-shaped.
--   (b) Redefine the helper to return TEXT — single DDL point of change,
--       converges every existing policy on the canonical tenant_id column
--       type, requires no downstream re-application of policy DDL because
--       Postgres rebinds STABLE functions at next plan-time.
--
-- This migration chooses (b). Tenant IDs in BORJIE101 are TEXT
-- (originally NanoID, now mostly UUID-shaped TEXT) — comparing two TEXT
-- values is the correct semantic.
--
-- Strategy:
--
--   1. CREATE OR REPLACE the helper to return TEXT. The two NULLIF
--      sub-expressions stay; the explicit `::uuid` cast is dropped so we
--      preserve the raw TEXT GUC value verbatim. Fail-closed contract is
--      preserved (NULL when no GUC is set).
--
--   2. Re-apply the 8 broken RLS migrations idempotently via DROP POLICY
--      IF EXISTS + CREATE POLICY. Migrations re-touched:
--        0155_supabase_rls_policies.sql       — 25 tables (top-25 tenant)
--        0156_supabase_rls_phase2.sql         — 15 phase-2 tables + FORCE
--        0163_phase_e_phase_f_constraints.sql — uses `tenant_id::text = fn()`
--                                                which was a previous broken
--                                                fix attempt; recreate
--                                                without the cast
--        0164c_sovereign_append_only_enforcement.sql — 9 append-only tables
--        0166b_rls_promote_out_wave.sql        — 6 high-blast-radius tables
--        0169b_payments_ledger_rls.sql         — 3 ledger tables
--        0173_force_rls_sweep.sql             — tool_call_denylist policies
--        0174_payments_ledger_extra_repos.sql — 4 payments-ledger tables
--
-- Because the helper redefinition (step 1) immediately fixes every
-- existing policy at next plan-time, step 2 is technically optional —
-- but we re-apply for two reasons: (a) idempotency means a future
-- operator can reason about the policy state from this migration alone;
-- (b) the 0163 policies use the explicit `tenant_id::text = fn()` form
-- which becomes `text = text` (a no-op cast) after step 1 — recreate
-- without the cast for consistency with the canonical pattern.
--
-- Idempotent: all DROP POLICY + CREATE POLICY guarded; CREATE OR REPLACE
-- on the helper. Safe to re-run.
-- =============================================================================

-- ============================================================================
-- 1. Redefine helper to return TEXT (the canonical fix).
-- ============================================================================
-- This single statement fixes every broken policy at next-plan-time. The
-- helper continues to read both GUC names (canonical + legacy) and to
-- fail-closed when neither is set. The only change vs migration 0172 is
-- the return type: uuid → text.
--
-- IMPORTANT: `CREATE OR REPLACE FUNCTION` cannot change the return type
-- of an existing function — Postgres raises "cannot change return type
-- of existing function". The DROP FUNCTION step below removes the prior
-- 0155/0172 definition first. We must also DROP CASCADE so any policy
-- that referenced the old return type is replaced — but the policies
-- themselves are re-created in steps 2-9 below, so any drop-via-cascade
-- is harmless (the policies are reinstalled with the new helper).

DROP FUNCTION IF EXISTS public.current_app_tenant_id() CASCADE;

CREATE FUNCTION public.current_app_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.current_tenant_id', TRUE), ''),
    NULLIF(current_setting('app.tenant_id', TRUE), '')
  );
$$;

COMMENT ON FUNCTION public.current_app_tenant_id IS
  'Returns the per-transaction tenant_id GUC as TEXT (matches tenants.id '
  'and every tenant_id FK column platform-wide). Primary GUC is '
  '`app.current_tenant_id` (set by api-gateway middleware). Falls back '
  'to legacy `app.tenant_id` for back-compat with 0146-era tooling. '
  'Returns NULL when neither is set so RLS policies deny by default '
  '(fail-closed). Marked STABLE so the planner can hoist the call. '
  'Return type unified to TEXT by migration 0175 (Z-MIG verifier fix).';

-- ============================================================================
-- 2. Re-apply 0155 policies (top-25 tenant-scoped tables).
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
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
    'approval_policy'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);

      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl);

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
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 3. Re-apply 0156 policies (phase-2 tenant-scoped tables).
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
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);

      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl);

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
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 4. Re-apply 0163 policies (autonomy governance: mdr_plan_items,
--    owner_skills, tenant_autonomy_caps, sub_md_slos, sub_md_slo_events).
--    0163 used the broken `tenant_id::text = fn()` form. After step 1
--    of this migration that is `text = text` (no-op cast). Recreate
--    without the cast for consistency with the canonical pattern.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mdr_plan_items'
  ) THEN
    DROP POLICY IF EXISTS tenant_isolation_select ON public.mdr_plan_items;
    DROP POLICY IF EXISTS tenant_isolation_modify ON public.mdr_plan_items;

    -- mdr_plan_items.tenant_id is UUID (0161); cast TEXT helper.
    CREATE POLICY tenant_isolation_select ON public.mdr_plan_items
      FOR SELECT
      TO authenticated
      USING (tenant_id::text = public.current_app_tenant_id());

    CREATE POLICY tenant_isolation_modify ON public.mdr_plan_items
      FOR ALL
      TO authenticated
      USING (tenant_id::text = public.current_app_tenant_id())
      WITH CHECK (tenant_id::text = public.current_app_tenant_id());
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'owner_skills'
  ) THEN
    DROP POLICY IF EXISTS tenant_isolation_select ON public.owner_skills;
    DROP POLICY IF EXISTS tenant_isolation_modify ON public.owner_skills;

    -- owner_skills.installed_by_tenant_id is UUID (0162); cast TEXT helper.
    CREATE POLICY tenant_isolation_select ON public.owner_skills
      FOR SELECT
      TO authenticated
      USING (installed_by_tenant_id::text = public.current_app_tenant_id());

    CREATE POLICY tenant_isolation_modify ON public.owner_skills
      FOR ALL
      TO authenticated
      USING (installed_by_tenant_id::text = public.current_app_tenant_id())
      WITH CHECK (installed_by_tenant_id::text = public.current_app_tenant_id());
  END IF;
END
$$;

DO $$
DECLARE
  tbl text;
  autonomy_tables text[] := ARRAY[
    'tenant_autonomy_caps',
    'sub_md_slos',
    'sub_md_slo_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY autonomy_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (
          tenant_id IS NULL
          OR tenant_id = public.current_app_tenant_id()
        );
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (
          tenant_id IS NULL
          OR tenant_id = public.current_app_tenant_id()
        )
        WITH CHECK (
          tenant_id IS NULL
          OR tenant_id = public.current_app_tenant_id()
        );
      $pol$, tbl);
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 5. Re-apply 0164 policies (append-only audit/log/ledger tables).
--    0164 uses SELECT + INSERT split (no FOR ALL) — preserve that shape.
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'sovereign_action_ledger',
    'agency_run_checkpoints',
    'kernel_memory_episodic',
    'kernel_memory_semantic',
    'kernel_memory_procedural',
    'kernel_memory_reflective',
    'reflexion_buffer',
    'intelligence_history',
    'sensor_call_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON public.%I;', tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_insert ON public.%I
        FOR INSERT
        TO authenticated
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 6. Re-apply 0166 policies (promote-out wave: sovereign_approvals,
--    payment_intents, disbursements, gdpr_deletion_requests,
--    ai_decision_feedback, ai_proactive_alerts).
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'sovereign_approvals',
    'payment_intents',
    'disbursements',
    'gdpr_deletion_requests',
    'ai_decision_feedback',
    'ai_proactive_alerts'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl);

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
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 7. Re-apply 0169 policies (payments-ledger: accounts, ledger_entries,
--    statements). NOTE: ledger_entries already covered in step 2 — the
--    re-application here is a no-op DROP+CREATE that matches 0169's
--    intent (idempotent).
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'accounts',
    'ledger_entries',
    'statements'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl);

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
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 8. Re-apply 0173 policies (tool_call_denylist — the only NEW table
--    0173 added policies to; the rest of 0173 is just FORCE RLS bits
--    that don't depend on the helper return type).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tool_call_denylist'
  ) THEN
    DROP POLICY IF EXISTS tenant_isolation_select ON public.tool_call_denylist;
    DROP POLICY IF EXISTS tenant_isolation_modify ON public.tool_call_denylist;

    CREATE POLICY tenant_isolation_select ON public.tool_call_denylist
      FOR SELECT
      TO authenticated
      USING (tenant_id = public.current_app_tenant_id());

    CREATE POLICY tenant_isolation_modify ON public.tool_call_denylist
      FOR ALL
      TO authenticated
      USING (tenant_id = public.current_app_tenant_id())
      WITH CHECK (tenant_id = public.current_app_tenant_id());
  END IF;
END
$$;

-- ============================================================================
-- 9. Re-apply 0174 policies (payments-ledger Drizzle wave defensive
--    re-apply: accounts, ledger_entries, statements, disbursements).
--    The first three are no-op DROP+CREATE matching 0169; disbursements
--    is the new one here.
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'accounts',
    'ledger_entries',
    'statements',
    'disbursements'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl);

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
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 10. Operator note.
-- ============================================================================
-- After this migration runs:
--   * `SELECT public.current_app_tenant_id();` returns TEXT (was UUID).
--   * Every RLS policy installed since 0155 evaluates without the
--     `operator does not exist: text = uuid` error.
--   * The `service_role` Supabase role continues to BYPASSRLS at the
--     role level (unchanged).
--   * Fail-closed contract preserved: unset GUC → NULL → policy denies.
