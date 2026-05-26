-- =============================================================================
-- 0270: mission_drift_log — Piece Q (Long-horizon Agency Loop).
--
-- Append-only-spirit log of every replan / drift event on a mission.
-- Together with mission_checkpoints this gives the assigning persona a
-- complete history of how the plan evolved between the original
-- decomposition and the final outcome.
--
-- drift_kind taxonomy:
--   * goal_shift       — the goal itself was edited (rare, HITL only)
--   * step_replan      — a step's payload / kind / ordering changed
--   * budget_overrun   — spent_minor_units crossed budget_minor_units
--   * deadline_slip    — expected_completion_date pushed out
--   * external_blocker — an external dependency (counter-party,
--                        regulator) blocked progress
--
-- detected_by:
--   * self            — the drift_detector flagged it on a checkpoint
--   * human           — a human edited the mission directly
--   * drift_detector  — synonym kept for backwards-compat with early
--                       Piece Q drafts
--
-- approved_by_user_id is populated when the autonomy_tier required HITL
-- on this drift kind and a human approved (or the brain auto-approved
-- under AUTONOMOUS tier for LOW risk).
--
-- RLS: gold-standard pattern.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mission_drift_log (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id          TEXT NOT NULL REFERENCES agency_missions(id) ON DELETE CASCADE,
  drift_kind          TEXT NOT NULL,
  description         TEXT NOT NULL,
  before_jsonb        JSONB,
  after_jsonb         JSONB,
  detected_by         TEXT NOT NULL,
  approved_by_user_id TEXT REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mission_drift_log_kind_chk
    CHECK (drift_kind IN ('goal_shift', 'step_replan', 'budget_overrun', 'deadline_slip', 'external_blocker')),
  CONSTRAINT mission_drift_log_detected_by_chk
    CHECK (detected_by IN ('self', 'human', 'drift_detector')),
  CONSTRAINT mission_drift_log_approval_consistent
    CHECK (
      (approved_at IS NULL AND approved_by_user_id IS NULL)
      OR (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_mission_drift_log_mission_created
  ON mission_drift_log (mission_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_drift_log_tenant_kind
  ON mission_drift_log (tenant_id, drift_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mission_drift_log_pending_approval
  ON mission_drift_log (tenant_id, mission_id)
  WHERE approved_at IS NULL;

COMMENT ON TABLE mission_drift_log IS
  'Piece Q — append-only-spirit log of replan / drift events. Captures the before/after state of every plan mutation so the assigning persona can audit how the mission evolved.';

COMMENT ON COLUMN mission_drift_log.before_jsonb IS
  'Snapshot of the affected slice of state BEFORE the drift event. For step_replan this is the prior mission_steps row; for deadline_slip this is the prior expected_completion_date; etc.';

COMMENT ON COLUMN mission_drift_log.after_jsonb IS
  'Snapshot of the affected slice of state AFTER the drift event.';

COMMENT ON COLUMN mission_drift_log.detected_by IS
  'self (drift_detector flagged on checkpoint), human (direct user edit), or drift_detector (synonym for self — backwards-compat).';

COMMENT ON COLUMN mission_drift_log.approved_by_user_id IS
  'HITL approver. NULL when autonomy_tier = AUTONOMOUS and the drift was auto-approved (LOW risk only).';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'mission_drift_log'
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

-- Operator note: this table is append-only by convention (no UPDATE /
-- DELETE policy beyond the catch-all FOR ALL). Production scripts that
-- need to "correct" a drift event MUST insert a new row with
-- drift_kind = 'step_replan' citing the previous row in description.
