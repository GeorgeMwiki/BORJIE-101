-- =============================================================================
-- 0241: employees — Piece M Agentic Workforce Management.
--
-- The brain manages a real estate company's workforce. This table is the
-- root pointer from a person-entity to a workforce role. T4-employee /
-- T3-manager / T2-DG hierarchy is expressed via the self-referencing
-- `manager_employee_id` column.
--
-- `person_entity_id` is a SOFT TEXT pointer to `core_entity.id` of type
-- PERSON. The core_entity table is owned by Pieces D+F; until that lands
-- in this worktree, the FK constraint is OMITTED and added in a later
-- migration (see Piece D+F arrival notes).
--
-- `title_id` is also a SOFT TEXT pointer because the `titles` table
-- ships with Pieces D+F. The constraint will be added once that table
-- exists.
--
-- This migration:
--   1. Creates the `employees` table.
--   2. Creates indexes for the common access paths:
--        * (tenant_id, manager_employee_id) — reporting-chain walks
--        * (tenant_id, status) — active-roster filter
--        * (tenant_id, person_entity_id) — person-to-employee lookup
--   3. Installs the GOLD-STANDARD RLS pattern from
--      0182_section_layouts.sql / 0185_decision_traces.sql.
--
-- Idempotent: every operation gated on object existence; safe to re-run
-- on a fresh database.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create employees table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employees (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** core_entity.id of type PERSON. FK added later when Pieces D+F land. */
  person_entity_id     TEXT NOT NULL,
  /** titles.id pointer. FK added later when Pieces D+F land. */
  title_id             TEXT,
  /** Internal employee code (free text — KPI scoreboards, payroll). */
  employee_code        TEXT,
  hired_at             DATE,
  /** Lifecycle: active | on_leave | terminated. TEXT for forward-compat. */
  status               TEXT NOT NULL DEFAULT 'active',
  /** Self-FK for reporting chain. NULL = root (DG-tier). */
  manager_employee_id  TEXT REFERENCES employees(id) ON DELETE SET NULL,
  /** Preferred delivery channel: web | mobile | whatsapp | sms. */
  default_channel      TEXT NOT NULL DEFAULT 'web',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant_manager
  ON employees (tenant_id, manager_employee_id);

CREATE INDEX IF NOT EXISTS idx_employees_tenant_status
  ON employees (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_employees_tenant_person
  ON employees (tenant_id, person_entity_id);

COMMENT ON TABLE employees IS
  'Piece M workforce root. Maps a person-entity to a workforce role with a self-referencing reporting chain. RLS-scoped via current_app_tenant_id() GUC helper.';

COMMENT ON COLUMN employees.person_entity_id IS
  'SOFT TEXT pointer to core_entity.id (type PERSON). Hard FK added when Pieces D+F land in this worktree.';

COMMENT ON COLUMN employees.title_id IS
  'SOFT TEXT pointer to titles.id. Hard FK added when Pieces D+F land.';

COMMENT ON COLUMN employees.status IS
  'Lifecycle state — active | on_leave | terminated. TEXT (not pgEnum) for forward-compat.';

COMMENT ON COLUMN employees.default_channel IS
  'Preferred follow-up delivery channel. web | mobile | whatsapp | sms. The followup-scheduler reads this.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'employees'
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
