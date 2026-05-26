-- =============================================================================
-- 0249: workforce_kpis — Piece M Agentic Workforce Management.
--
-- Daily roll-ups per tenant. One row per (tenant_id, day). Upserted by
-- the nightly cron and by the assignment-status state machine on
-- material transitions (completion, deadline miss).
--
-- UNIQUE(tenant_id, day) means the writer ALWAYS upserts; never insert
-- without ON CONFLICT.
-- =============================================================================

CREATE TABLE IF NOT EXISTS workforce_kpis (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day                    DATE NOT NULL,
  total_assignments      INTEGER NOT NULL DEFAULT 0,
  completed_on_time      INTEGER NOT NULL DEFAULT 0,
  overdue                INTEGER NOT NULL DEFAULT 0,
  blockers_open          INTEGER NOT NULL DEFAULT 0,
  /** Mean completion duration in hours for assignments completed on this day. */
  avg_completion_hours   NUMERIC(8,2),
  UNIQUE (tenant_id, day)
);

CREATE INDEX IF NOT EXISTS idx_workforce_kpis_tenant_day
  ON workforce_kpis (tenant_id, day DESC);

COMMENT ON TABLE workforce_kpis IS
  'Piece M daily workforce roll-up per tenant. Upsert-only — UNIQUE(tenant_id, day) enforced. RLS via current_app_tenant_id() GUC.';

COMMENT ON COLUMN workforce_kpis.completed_on_time IS
  'Count of assignments completed on this day where completed_at <= due_at.';

COMMENT ON COLUMN workforce_kpis.blockers_open IS
  'Count of assignments with status="blocked" at the close of this day.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'workforce_kpis'
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
