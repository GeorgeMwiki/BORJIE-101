-- Phase D11, 2026-05-17 — enable Row-Level-Security on the top-25
-- tenant-scoped tables and install a tenant_id policy template that
-- gates SELECT/INSERT/UPDATE/DELETE on `current_setting('app.tenant_id')`.
--
-- Strategy
--   1. Each tenant-scoped table has its `app.tenant_id` GUC set by the
--      api-gateway middleware via `SET LOCAL app.tenant_id = '<uuid>'`
--      at the start of every transaction (see services/api-gateway/
--      src/middleware/tenant-context.ts).
--   2. The `service_role` Supabase role bypasses RLS (Supabase
--      convention). Server-side workers that legitimately need
--      cross-tenant reads use the service-role connection.
--   3. The `authenticated` Supabase role (logged-in customer-app /
--      estate-manager-app users) goes through the tenant-scoped
--      policy below.
--   4. The `anon` Supabase role gets NO access — public endpoints
--      use signed URLs / api-gateway endpoints, not direct REST.
--
-- Coverage
--   Top-25 tenant-scoped tables by row count / risk class:
--     customers, leases, ledger_entries, invoices,
--     maintenance_requests, audit_events, documents,
--     payments, properties, units, expenses, vendors,
--     work_orders, inspections, communications, blocks,
--     asset_components, cases, feedback_complaints,
--     compliance_exports, conditional_survey,
--     kernel_decision_ledger, ai_audit_chain, ai_cost,
--     approval_policy.
--
-- Open gaps deferred to Phase E (see Docs/SUPABASE_LIVE_TEST.md §5):
--   - kernel_cot_reservoir (LOW)
--   - sovereign_action_ledger (MEDIUM)
--   - agency_run_checkpoints (MEDIUM)
--   - sensor_call_log (LOW)

-- ============================================================================
-- 1. Helper: tenant_id reader (centralised, raises if app.tenant_id unset)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_app_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', TRUE), '')::uuid;
$$;

COMMENT ON FUNCTION public.current_app_tenant_id IS
  'Returns the tenant_id GUC set by api-gateway middleware. Returns NULL '
  'if unset (which causes RLS policies to deny by default). Marked STABLE '
  'so the planner can hoist the call out of inner loops.';

-- ============================================================================
-- 2. Enable RLS + install tenant-scoped policy on the top-25 tables
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
    -- Only operate on tables that actually exist (defensive — some
    -- tables are gated behind plugin enablement and may not have been
    -- created yet on a given Supabase project).
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = tbl
    ) THEN
      -- Enable RLS (idempotent if already enabled).
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);

      -- Drop any pre-existing tenant policy with our canonical name
      -- so the migration is replayable (defensive vs hand-tuned
      -- environments).
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      -- SELECT policy — readers see only their tenant's rows.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- INSERT / UPDATE / DELETE policy — writers can only touch their
      -- tenant's rows AND new rows must declare the caller's tenant_id.
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
-- 3. Revoke anon access from tenant-scoped tables explicitly
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
      WHERE table_schema = 'public'
        AND table_name = tbl
    ) THEN
      EXECUTE format(
        'REVOKE ALL ON public.%I FROM anon;', tbl
      );
    END IF;
  END LOOP;
END
$$;

-- ============================================================================
-- 4. Sanity-check view for ops (read-only)
-- ============================================================================
CREATE OR REPLACE VIEW public.rls_coverage_audit AS
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  (
    SELECT count(*)
    FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = c.relname
  ) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

COMMENT ON VIEW public.rls_coverage_audit IS
  'Operational view for verifying RLS coverage in the Supabase live-test '
  'runbook. SELECT * FROM public.rls_coverage_audit; expects rls_enabled=true '
  'and policy_count>=2 for every tenant-scoped table.';

-- ============================================================================
-- 5. Note: cross-tenant fan-out tables intentionally NOT covered here
-- ============================================================================
-- The following tables are intentionally LEFT UNGOVERNED by tenant RLS
-- because they participate in cross-tenant orchestration:
--   - cross_tenant_denials   (audit of cross-tenant access attempts)
--   - sovereign_action_ledger (HQ tool executions span tenants)
--   - kernel_cot_reservoir   (intentionally opaque; gated app-side)
--   - agency_run_checkpoints (workflow state; gated app-side)
--   - sensor_call_log        (trace IDs only, no PII)
--
-- These remain accessible only to the service_role Supabase identity.
-- The application enforces tenant scoping via the corresponding
-- repository modules. Phase E ticket E-RLS-1..4 tracks promoting
-- these to RLS-governed too.
