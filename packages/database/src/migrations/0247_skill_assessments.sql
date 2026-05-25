-- =============================================================================
-- 0247: skill_assessments — Piece M Agentic Workforce Management.
--
-- Per-employee skill graph. The skill-inferrer updates proficiency_score
-- from observed performance_signals; managers can override (source_kind
-- = manager_rated). Skills are tracked by slug; the canonical slug list
-- is application-owned (e.g. 'lease_negotiation', 'condition_survey',
-- 'tenant_relations', 'rent_collection', 'maintenance_dispatch', ...).
--
-- UNIQUE(tenant_id, employee_id, skill_slug) — one row per skill per
-- employee per tenant. Upsert pattern is the only write path.
--
-- source_kind values:
--   * self_rated      — employee onboarding survey
--   * manager_rated   — manager review override (always wins)
--   * ai_inferred     — skill-inferrer derived (default)
-- =============================================================================

CREATE TABLE IF NOT EXISTS skill_assessments (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id         TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  /** Canonical skill slug (application-owned vocabulary). */
  skill_slug          TEXT NOT NULL,
  /** 0.00 (novice) to 1.00 (expert). */
  proficiency_score   NUMERIC(3,2) NOT NULL,
  last_assessed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** self_rated | manager_rated | ai_inferred (default). */
  source_kind         TEXT NOT NULL DEFAULT 'inferred',
  UNIQUE (tenant_id, employee_id, skill_slug)
);

CREATE INDEX IF NOT EXISTS idx_skill_assessments_employee_skill
  ON skill_assessments (tenant_id, employee_id, skill_slug);

CREATE INDEX IF NOT EXISTS idx_skill_assessments_skill_score
  ON skill_assessments (tenant_id, skill_slug, proficiency_score DESC);

COMMENT ON TABLE skill_assessments IS
  'Piece M per-employee skill graph. Upsert-only. RLS via current_app_tenant_id() GUC.';

COMMENT ON COLUMN skill_assessments.proficiency_score IS
  '0.00 novice .. 1.00 expert. Sigmoid-derived from rolling performance_signals by the skill-inferrer.';

COMMENT ON COLUMN skill_assessments.source_kind IS
  'self_rated | manager_rated | ai_inferred (default = "inferred"). manager_rated always wins over inferred on next upsert.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'skill_assessments'
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
