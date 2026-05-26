-- =============================================================================
-- 0243: work_followups — Piece M Agentic Workforce Management.
--
-- Scheduled future check-ins on a work_assignment. The followup-scheduler
-- cron reads rows where status='pending' AND scheduled_at <= NOW() and
-- dispatches via the notifications service. Cadence kinds map roughly to:
--   * daily         — every day until completion
--   * mid_week      — Wednesday at 10am tenant-local
--   * end_of_week   — Friday at 4pm tenant-local
--   * one_shot      — a single ad-hoc check-in
--
-- Status transitions: pending → sent → (responded | missed).
-- =============================================================================

CREATE TABLE IF NOT EXISTS work_followups (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id   TEXT NOT NULL REFERENCES work_assignments(id) ON DELETE CASCADE,
  scheduled_at    TIMESTAMPTZ NOT NULL,
  /** daily | mid_week | end_of_week | one_shot. */
  cadence_kind    TEXT NOT NULL,
  /** Channel for dispatch — defaults to whatsapp (best for field workers). */
  channel         TEXT NOT NULL DEFAULT 'whatsapp',
  /** pending | sent | responded | missed. */
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_followups_due
  ON work_followups (tenant_id, status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_work_followups_assignment
  ON work_followups (tenant_id, assignment_id);

COMMENT ON TABLE work_followups IS
  'Piece M followup row. The cron-driven scheduler reads pending rows due now and dispatches a check-in via the notifications service. RLS via current_app_tenant_id() GUC.';

COMMENT ON COLUMN work_followups.cadence_kind IS
  'daily | mid_week | end_of_week | one_shot. The assign-task entrypoint schedules a cadence based on the assignment risk_tier + due_at.';

COMMENT ON COLUMN work_followups.status IS
  'pending → sent → (responded | missed). missed = sent but no check-in within the grace window.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'work_followups'
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
