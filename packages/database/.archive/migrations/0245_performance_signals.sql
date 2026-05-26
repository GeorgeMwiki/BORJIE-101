-- =============================================================================
-- 0245: performance_signals — Piece M Agentic Workforce Management.
--
-- Observable performance signals per employee. Append-only by convention
-- (no append-only trigger because manager corrections are valid). Each
-- signal carries a weighted score; rolling aggregates feed advisory_briefs
-- and skill_assessments.
--
-- Signal kinds:
--   * on_time_completion    — positive  (weight +1.0 by default)
--   * missed_deadline       — negative  (weight -1.5)
--   * repeated_blocker      — negative  (weight -2.0)
--   * exceptional_work      — positive  (weight +2.0, manager-stamped)
--   * positive_sentiment    — positive  (weight +0.5, sentiment-derived)
--   * negative_sentiment    — negative  (weight -0.5)
--
-- source_kind values:
--   * check_in       — emitted by the check-in-receiver path
--   * audit_event    — emitted by background scanners (deadline-miss)
--   * manual         — manager-stamped
--   * ai_observation — kernel-derived from broader signals
-- =============================================================================

CREATE TABLE IF NOT EXISTS performance_signals (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  /** See header comment for the canonical list. TEXT for forward-compat. */
  signal_kind     TEXT NOT NULL,
  /** Positive or negative; the kernel applies sign in performance-tracker. */
  weight          NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  /** Free-form context: assignment_id, manager_note, etc. */
  context_jsonb   JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** check_in | audit_event | manual | ai_observation. */
  source_kind     TEXT NOT NULL,
  /** Free-form pointer back to the source row id (e.g. check_in.id). */
  source_ref      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_signals_employee_created
  ON performance_signals (tenant_id, employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_performance_signals_kind_created
  ON performance_signals (tenant_id, signal_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_performance_signals_source
  ON performance_signals (tenant_id, source_kind, source_ref);

COMMENT ON TABLE performance_signals IS
  'Piece M performance signal row. Weighted observable events per employee. Rolling aggregates feed advisory_briefs + skill_assessments. RLS via current_app_tenant_id() GUC.';

COMMENT ON COLUMN performance_signals.weight IS
  'Caller-set weight. Convention: positive signal_kind values carry positive weight, negative kinds carry negative weight. The kernel enforces sign in performance-tracker.';

COMMENT ON COLUMN performance_signals.context_jsonb IS
  'Free-form context. Common keys: assignment_id, manager_note, observed_metric.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'performance_signals'
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
