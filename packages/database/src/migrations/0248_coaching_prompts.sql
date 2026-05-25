-- =============================================================================
-- 0248: coaching_prompts — Piece M Agentic Workforce Management.
--
-- Auto-generated coaching messages sent to employees. The coaching-
-- generator emits these on threshold crossings (e.g. 3+ blockers in a
-- rolling 30-day window).
--
-- HITL required when prompt_text mentions termination / discipline /
-- demotion — the kernel scans the prompt and refuses to flip
-- status='sent' without manager confirmation. That decision lives in
-- the package (coaching-generator), not the schema.
--
-- Status transitions: pending → sent → (read | dismissed).
-- =============================================================================

CREATE TABLE IF NOT EXISTS coaching_prompts (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id     TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  /** repeated_blocker | missed_deadline | mastery_milestone | low_sentiment | exceptional_recognition. */
  trigger_kind    TEXT NOT NULL,
  prompt_text     TEXT NOT NULL,
  /** pending | sent | read | dismissed. */
  status          TEXT NOT NULL DEFAULT 'pending',
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coaching_prompts_employee_created
  ON coaching_prompts (tenant_id, employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_coaching_prompts_status
  ON coaching_prompts (tenant_id, status, created_at DESC);

COMMENT ON TABLE coaching_prompts IS
  'Piece M auto-generated coaching messages. HITL-gated when prompt_text mentions termination / discipline. RLS via current_app_tenant_id() GUC.';

COMMENT ON COLUMN coaching_prompts.trigger_kind IS
  'repeated_blocker | missed_deadline | mastery_milestone | low_sentiment | exceptional_recognition.';

COMMENT ON COLUMN coaching_prompts.status IS
  'pending → sent → (read | dismissed). status="pending" rows are HITL-gated when prompt_text contains disciplinary language.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'coaching_prompts'
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
