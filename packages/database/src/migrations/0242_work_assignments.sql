-- =============================================================================
-- 0242: work_assignments — Piece M Agentic Workforce Management.
--
-- The unit of work the brain assigns to a T4-employee on behalf of a
-- T3-manager or T2-DG. One row per assignment. Status transitions:
-- pending → in_progress → (completed | cancelled). Blocked is a special
-- state surfaced by the escalation engine.
--
-- Soft TEXT pointers:
--   * mission_id        — Piece Q (long-horizon missions). FK added later.
--   * created_by_persona_id — personas table is owned by ai-copilot. The
--     constraint will be added once the personas table lands here.
--   * audit_chain_id    — ai_audit_chain.id (already exists). Kept as a
--     soft pointer because a single assignment can produce many chained
--     audit rows; this column holds the FIRST entry id for navigation.
--   * asset_refs        — core_entity.id list. Hard FK is impossible for
--     a TEXT[] anyway; the kernel validates at the application boundary.
-- =============================================================================

CREATE TABLE IF NOT EXISTS work_assignments (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** Piece Q long-horizon mission link. SOFT pointer; FK added later. */
  mission_id               TEXT,
  title                    TEXT NOT NULL,
  description              TEXT NOT NULL,
  assigned_employee_id     TEXT NOT NULL REFERENCES employees(id),
  assigned_by_user_id      TEXT NOT NULL REFERENCES users(id),
  /** low | medium | high | urgent. TEXT for forward-compat. */
  priority                 TEXT NOT NULL DEFAULT 'medium',
  due_at                   TIMESTAMPTZ,
  estimated_effort_hours   NUMERIC(6,2),
  /** pending | in_progress | blocked | completed | cancelled. */
  status                   TEXT NOT NULL DEFAULT 'pending',
  /** LOW | MEDIUM | HIGH | SOVEREIGN. Drives HITL gate. */
  risk_tier                TEXT NOT NULL DEFAULT 'LOW',
  /** True iff HIGH-risk or SOVEREIGN. The kernel sets this; never trust caller. */
  hitl_required            BOOLEAN NOT NULL DEFAULT FALSE,
  /** core_entity.id list (units, leases, etc.). Kernel-validated at boundary. */
  asset_refs               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  /** The persona that authored the assignment. SOFT pointer to personas.id. */
  created_by_persona_id    TEXT,
  /** First ai_audit_chain row id for this assignment. SOFT pointer. */
  audit_chain_id           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_work_assignments_tenant_employee_status
  ON work_assignments (tenant_id, assigned_employee_id, status);

CREATE INDEX IF NOT EXISTS idx_work_assignments_tenant_status_due
  ON work_assignments (tenant_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_work_assignments_tenant_mission
  ON work_assignments (tenant_id, mission_id);

CREATE INDEX IF NOT EXISTS idx_work_assignments_tenant_assigned_by
  ON work_assignments (tenant_id, assigned_by_user_id);

COMMENT ON TABLE work_assignments IS
  'Piece M workforce assignment row. One unit of work assigned to a T4-employee. Status: pending → in_progress → (completed | cancelled | blocked). RLS via current_app_tenant_id() GUC.';

COMMENT ON COLUMN work_assignments.mission_id IS
  'SOFT pointer to Piece Q missions.id. FK added when Piece Q lands.';

COMMENT ON COLUMN work_assignments.risk_tier IS
  'LOW | MEDIUM | HIGH | SOVEREIGN. Kernel-derived; HIGH and SOVEREIGN imply hitl_required=true.';

COMMENT ON COLUMN work_assignments.hitl_required IS
  'Brain-derived flag. The kernel ALWAYS sets this; do not trust caller-supplied values.';

COMMENT ON COLUMN work_assignments.asset_refs IS
  'TEXT[] of core_entity.id pointers (units, leases, properties). Kernel validates at the application boundary.';

COMMENT ON COLUMN work_assignments.created_by_persona_id IS
  'SOFT pointer to personas.id (ai-copilot). The persona that emitted the assignment.';

COMMENT ON COLUMN work_assignments.audit_chain_id IS
  'SOFT pointer to ai_audit_chain.id. The FIRST chain row for this assignment; subsequent events extend the chain.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'work_assignments'
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
