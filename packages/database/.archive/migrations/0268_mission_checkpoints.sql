-- =============================================================================
-- 0268: mission_checkpoints — Piece Q (Long-horizon Agency Loop).
--
-- Daily / weekly / milestone review points on a mission. At each
-- scheduled_at the checkpoint_runner summarises what was accomplished
-- since the previous checkpoint, surfaces newly-discovered gaps, and
-- records any drift signals it found (the drift_detector emits a
-- separate row in mission_drift_log for each concrete drift).
--
-- needs_human_review = true when the checkpoint contains drift the
-- replan_engine refused to handle autonomously (mission autonomy_tier
-- requires HITL on a tier of drift it can't downgrade).
--
-- Daily checkpoints summarise the previous day's dispatch run. Weekly
-- checkpoints produce the "progress brief" sent to the assigning persona
-- (T1 / T2). Milestone checkpoints fire on user-defined inflection
-- points (e.g. "lessee signed", "deposit received").
--
-- RLS: gold-standard pattern.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mission_checkpoints (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id            TEXT NOT NULL REFERENCES agency_missions(id) ON DELETE CASCADE,
  checkpoint_kind       TEXT NOT NULL,
  scheduled_at          TIMESTAMPTZ NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending',
  summary               TEXT,
  /** Gaps the checkpoint discovered — JSONB array of {kind, label,
      severity} entries. Surfaced to the assigning persona's UI. */
  gaps_jsonb            JSONB,
  /** Drift signals observed since the last checkpoint. Distinct from
      mission_drift_log rows: drift_signals_jsonb is the raw input
      stream the detector saw, mission_drift_log contains the
      classified, persisted events. */
  drift_signals_jsonb   JSONB,
  needs_human_review    BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_at           TIMESTAMPTZ,
  reviewed_by_user_id   TEXT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mission_checkpoints_kind_chk
    CHECK (checkpoint_kind IN ('daily', 'weekly', 'milestone')),
  CONSTRAINT mission_checkpoints_status_chk
    CHECK (status IN ('pending', 'completed', 'missed')),
  CONSTRAINT mission_checkpoints_review_consistent
    CHECK (
      (reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
      OR (reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_mission_checkpoints_mission_scheduled
  ON mission_checkpoints (mission_id, scheduled_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_checkpoints_tenant_pending
  ON mission_checkpoints (tenant_id, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_mission_checkpoints_needs_review
  ON mission_checkpoints (tenant_id, mission_id)
  WHERE needs_human_review = TRUE AND reviewed_at IS NULL;

COMMENT ON TABLE mission_checkpoints IS
  'Piece Q — daily / weekly / milestone review points. Each row summarises mission progress since the previous checkpoint and surfaces gaps + drift signals. Weekly checkpoints generate the progress brief sent to the assigning persona.';

COMMENT ON COLUMN mission_checkpoints.gaps_jsonb IS
  'JSONB array of {kind, label, severity} entries describing newly-discovered gaps (missing data, stalled approvals, …).';

COMMENT ON COLUMN mission_checkpoints.drift_signals_jsonb IS
  'Raw drift signal stream the detector saw. Classified events are persisted in mission_drift_log.';

COMMENT ON COLUMN mission_checkpoints.needs_human_review IS
  'TRUE when the replan engine refused to handle drift autonomously and parked the mission for the assigning persona to review.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'mission_checkpoints'
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
