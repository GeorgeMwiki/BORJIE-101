-- =============================================================================
-- 0246: advisory_briefs — Piece M Agentic Workforce Management.
--
-- AI-written advisory to managers on workforce gaps + opportunities +
-- recommended strategic actions. Hash-chained into ai_audit_chain. The
-- audience_persona_id pointer scopes the brief to a specific persona
-- (e.g. the T2-DG sees a different brief than a T3-manager).
--
-- HITL: every advisory_brief requires a manager confirmation before
-- broadcast to T1/T2. The kernel writes the brief with status='draft'
-- (not represented as a column here — kernel-level concept tracked in
-- ai_audit_chain payload).
--
-- gaps_jsonb / opportunities_jsonb / recommended_actions_jsonb shape:
--   [{ title, severity, evidence_refs: ["<table>:<id>", ...] }]
-- citations_jsonb shape:
--   [{ source_kind, source_ref, snippet }]
-- =============================================================================

CREATE TABLE IF NOT EXISTS advisory_briefs (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** SOFT pointer to personas.id (ai-copilot owned). */
  audience_persona_id         TEXT,
  period_start                DATE NOT NULL,
  period_end                  DATE NOT NULL,
  /** Composite weekly score, 0..100. */
  overall_score               NUMERIC(4,2),
  /** [{title, severity, evidence_refs[]}] */
  gaps_jsonb                  JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** [{title, severity, evidence_refs[]}] */
  opportunities_jsonb         JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** [{title, severity, expected_impact, owner_persona_id?}] */
  recommended_actions_jsonb   JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** [{source_kind, source_ref, snippet}] */
  citations_jsonb             JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** SOFT pointer to ai_audit_chain.id — first chain row for this brief. */
  audit_chain_id              TEXT
);

CREATE INDEX IF NOT EXISTS idx_advisory_briefs_tenant_period
  ON advisory_briefs (tenant_id, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_advisory_briefs_audience
  ON advisory_briefs (tenant_id, audience_persona_id, period_end DESC);

COMMENT ON TABLE advisory_briefs IS
  'Piece M weekly workforce advisory brief. AI-written, hash-chained, HITL-confirmed before broadcast. RLS via current_app_tenant_id() GUC.';

COMMENT ON COLUMN advisory_briefs.audience_persona_id IS
  'SOFT pointer to personas.id. Different personas (T1/T2/T3) receive different briefs.';

COMMENT ON COLUMN advisory_briefs.gaps_jsonb IS
  '[{title, severity (low|medium|high|critical), evidence_refs: ["<table>:<id>", ...]}]';

COMMENT ON COLUMN advisory_briefs.recommended_actions_jsonb IS
  '[{title, severity, expected_impact, owner_persona_id?}]. owner_persona_id is who should execute.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'advisory_briefs'
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
