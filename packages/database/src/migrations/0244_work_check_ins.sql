-- =============================================================================
-- 0244: work_check_ins — Piece M Agentic Workforce Management.
--
-- The actual response from an employee. One row per employee reply. The
-- check-in-receiver records inbound WhatsApp / SMS / web events here and
-- updates the parent work_assignment status accordingly.
--
-- response_kind drives downstream behaviour:
--   * progress_update     → bump updated_at; no status change
--   * blocker             → status = blocked; emit performance signal;
--                            arm escalation rules
--   * completed           → status = completed; close followups
--   * request_extension   → manager review queued (no auto-extend)
--   * no_response         → recorded by the followup-scheduler when a
--                            followup goes from sent → missed
--
-- followup_id is NULL for ad-hoc check-ins (employee proactively reports
-- progress without a triggering followup).
-- =============================================================================

CREATE TABLE IF NOT EXISTS work_check_ins (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id       TEXT NOT NULL REFERENCES work_assignments(id) ON DELETE CASCADE,
  /** NULL for ad-hoc / unsolicited check-ins. */
  followup_id         TEXT REFERENCES work_followups(id) ON DELETE SET NULL,
  employee_id         TEXT NOT NULL REFERENCES employees(id),
  /** progress_update | blocker | completed | request_extension | no_response. */
  response_kind       TEXT NOT NULL,
  response_text       TEXT,
  /** Array of {kind, url, mime} blobs — kernel-validated at write. */
  attachments_jsonb   JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** -1.0 (negative) to 1.0 (positive). Computed by sentiment-analyzer. */
  sentiment_score     NUMERIC(3,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_check_ins_assignment_created
  ON work_check_ins (tenant_id, assignment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_check_ins_employee_created
  ON work_check_ins (tenant_id, employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_work_check_ins_kind
  ON work_check_ins (tenant_id, response_kind, created_at DESC);

COMMENT ON TABLE work_check_ins IS
  'Piece M employee response row. The check-in-receiver records inbound replies and updates the parent assignment. RLS via current_app_tenant_id() GUC.';

COMMENT ON COLUMN work_check_ins.response_kind IS
  'progress_update | blocker | completed | request_extension | no_response. no_response is system-emitted when a followup misses its grace window.';

COMMENT ON COLUMN work_check_ins.sentiment_score IS
  '-1.0 negative to 1.0 positive. Set by sentiment-analyzer (Haiku-cascade); NULL on cascade failure (fail-open).';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'work_check_ins'
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
