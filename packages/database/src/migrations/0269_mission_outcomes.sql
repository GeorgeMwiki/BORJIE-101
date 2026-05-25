-- =============================================================================
-- 0269: mission_outcomes — Piece Q (Long-horizon Agency Loop).
--
-- Terminal record for a mission. Written once at the end of the mission
-- lifecycle (status moves to completed / abandoned / escalated) by
-- outcome_writer.ts.
--
-- outcome_kind:
--   * success   — every required step completed; success criteria met
--   * partial   — some success criteria met, others not; mission ended
--                 inside its expected_completion_date but the assigner
--                 marked it short of full success
--   * failed    — the brain or a human gave up on the mission; success
--                 criteria not met
--   * abandoned — the assigning persona cancelled the mission outright
--
-- metrics_jsonb holds the structured KPI block the brain computes
-- {steps_completed, steps_failed, steps_skipped, days_elapsed,
--  cost_minor_units, replans, escalations, …}.
--
-- lessons_learned_jsonb is a JSONB ARRAY of {lesson, confidence,
-- sourceStepIds} entries — fed back into the Reflexion buffer
-- (0184 reflexion_buffer_extend) by outcome_writer.feedReflexion().
--
-- RLS: gold-standard pattern.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mission_outcomes (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id              TEXT NOT NULL REFERENCES agency_missions(id) ON DELETE CASCADE,
  outcome_kind            TEXT NOT NULL,
  /** Human-readable narrative; the brain composes this from the
      checkpoint summaries + the final step results. */
  narrative               TEXT NOT NULL,
  metrics_jsonb           JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** JSONB ARRAY of {lesson, confidence, sourceStepIds}. Fed back into
      reflexion_buffer by outcome_writer.feedReflexion(). */
  lessons_learned_jsonb   JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mission_outcomes_kind_chk
    CHECK (outcome_kind IN ('success', 'partial', 'failed', 'abandoned')),
  /** Exactly one terminal outcome per mission. */
  CONSTRAINT mission_outcomes_mission_unique
    UNIQUE (mission_id)
);

CREATE INDEX IF NOT EXISTS idx_mission_outcomes_tenant_kind
  ON mission_outcomes (tenant_id, outcome_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_outcomes_tenant_created
  ON mission_outcomes (tenant_id, created_at DESC);

COMMENT ON TABLE mission_outcomes IS
  'Piece Q — terminal mission record. Written once when a mission moves to completed / abandoned / escalated. Lessons learned feed into the Reflexion buffer for future planning.';

COMMENT ON COLUMN mission_outcomes.metrics_jsonb IS
  'Structured KPI block: {steps_completed, steps_failed, steps_skipped, days_elapsed, cost_minor_units, replans, escalations, …}.';

COMMENT ON COLUMN mission_outcomes.lessons_learned_jsonb IS
  'JSONB ARRAY of {lesson, confidence, sourceStepIds}. outcome_writer.feedReflexion() walks this and writes one reflexion_buffer row per lesson.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'mission_outcomes'
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
