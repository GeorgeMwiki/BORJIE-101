-- =============================================================================
-- 0267: mission_steps — Piece Q (Long-horizon Agency Loop).
--
-- Ordered list of concrete steps that make up an `agency_missions` row.
-- The step_dispatcher picks today's pending steps and dispatches them
-- via Piece E's action_runtime; the result lands in result_jsonb and
-- the status moves through `pending → in_progress → completed |
-- blocked | skipped | failed`.
--
-- Step kinds (free-text but checked against an allow-list):
--   * plan    — research / pre-work decisions before execution
--   * gather  — collect data, list assets, fetch sensor readings
--   * execute — emit a real-world action (send a WhatsApp, post a
--               ledger entry, sign a lease …)
--   * check   — verification step (did the inquiry land? did the
--               payment arrive?)
--   * reflect — write a summary / lessons-learned snippet
--
-- Soft pointer (TEXT, not FK):
--   * action_plan_id → action_plans.id (Piece E). Soft so this
--     migration can ship before Piece E's tables exist.
--
-- RLS: gold-standard pattern.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mission_steps (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mission_id      TEXT NOT NULL REFERENCES agency_missions(id) ON DELETE CASCADE,
  ordinal         SMALLINT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT,
  step_kind       TEXT NOT NULL,
  /** Soft pointer to action_plans.id (Piece E). NULL if step is
      informational (plan / reflect / check) and doesn't run an action
      plan. */
  action_plan_id  TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  /** Calendar day this step is intended to run. NULL until the daily
      cron has scheduled it. */
  scheduled_for   DATE,
  attempts        SMALLINT NOT NULL DEFAULT 0,
  result_jsonb    JSONB,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mission_steps_mission_ordinal_unique
    UNIQUE (mission_id, ordinal),
  CONSTRAINT mission_steps_step_kind_chk
    CHECK (step_kind IN ('plan', 'gather', 'execute', 'check', 'reflect')),
  CONSTRAINT mission_steps_status_chk
    CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'skipped', 'failed')),
  CONSTRAINT mission_steps_attempts_nonneg
    CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_mission_steps_mission_ordinal
  ON mission_steps (mission_id, ordinal);

CREATE INDEX IF NOT EXISTS idx_mission_steps_tenant_scheduled
  ON mission_steps (tenant_id, scheduled_for, status)
  WHERE scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mission_steps_tenant_status
  ON mission_steps (tenant_id, status, created_at DESC);

COMMENT ON TABLE mission_steps IS
  'Piece Q — ordered atomic steps within an agency_missions row. The step_dispatcher picks today''s pending steps and dispatches via Piece E action_runtime; results land in result_jsonb.';

COMMENT ON COLUMN mission_steps.action_plan_id IS
  'Soft pointer to action_plans.id (Piece E). TEXT not FK so Piece Q can ship independently of Piece E; the dispatcher falls back to a stub when the pointer is unresolvable.';

COMMENT ON COLUMN mission_steps.step_kind IS
  'plan | gather | execute | check | reflect. Drives the dispatcher''s choice between informational kernel calls and action-runtime invocations.';

COMMENT ON COLUMN mission_steps.attempts IS
  'Number of times the dispatcher has tried this step. The replan engine treats >=3 attempts on a non-skippable step as a drift signal.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'mission_steps'
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
