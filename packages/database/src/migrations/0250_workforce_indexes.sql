-- =============================================================================
-- 0250: workforce indexes + RLS finalization — Piece M closeout.
--
-- This migration:
--   1. Adds composite indexes for the hot paths the package exercises
--      that weren't covered by the per-table 0241-0249 migrations.
--   2. Re-runs the gold-standard RLS pattern in a SINGLE LOOP over
--      EVERY workforce table to guarantee zero-drift in the policy
--      shape. This is the canonical reference: when the audit-rls-
--      coverage scanner runs it picks up all 9 tables here.
--
-- All operations idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Hot-path composite indexes.
-- ─────────────────────────────────────────────────────────────────────────

-- followup-scheduler hot path: "rows pending whose scheduled_at <= now()".
CREATE INDEX IF NOT EXISTS idx_work_followups_pending_due
  ON work_followups (scheduled_at)
  WHERE status = 'pending';

-- escalation-rules hot path: "blocked assignments older than threshold".
CREATE INDEX IF NOT EXISTS idx_work_assignments_blocked_updated
  ON work_assignments (tenant_id, updated_at)
  WHERE status = 'blocked';

-- escalation-rules hot path: "overdue but still open".
CREATE INDEX IF NOT EXISTS idx_work_assignments_overdue_open
  ON work_assignments (tenant_id, due_at)
  WHERE status IN ('pending', 'in_progress');

-- skill-inferrer hot path: scan recent positive signals per employee.
CREATE INDEX IF NOT EXISTS idx_performance_signals_recent_by_kind
  ON performance_signals (tenant_id, employee_id, signal_kind, created_at DESC);

-- advisory-brief-engine hot path: weekly window queries.
CREATE INDEX IF NOT EXISTS idx_workforce_kpis_recent
  ON workforce_kpis (tenant_id, day DESC);

-- coaching-generator hot path: enumerate pending prompts per employee.
CREATE INDEX IF NOT EXISTS idx_coaching_prompts_pending_by_employee
  ON coaching_prompts (tenant_id, employee_id, created_at DESC)
  WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Final RLS sweep across all 9 workforce tables. Mirrors the
--    "audit-rls-coverage scanner" expectation (variable name
--    `tenant_tables`).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'employees',
    'work_assignments',
    'work_followups',
    'work_check_ins',
    'performance_signals',
    'advisory_briefs',
    'skill_assessments',
    'coaching_prompts',
    'workforce_kpis'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

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

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: this finalisation migration is INTENTIONALLY a no-op on
-- a green DB where 0241-0249 already ran cleanly. Its real job is to
-- guarantee no drift between policies across the 9 workforce tables —
-- if anyone later runs ALTER POLICY against one table, this migration
-- re-syncs them on the next deploy.
