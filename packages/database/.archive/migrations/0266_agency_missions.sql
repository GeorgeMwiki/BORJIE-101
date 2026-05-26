-- =============================================================================
-- 0266: agency_missions — Piece Q (Long-horizon Agency Loop).
--
-- Header row for a multi-day / multi-week mission. The brain decomposes a
-- high-level goal ("find a lessee for parcel X by Nov 30") into ordered
-- mission_steps (0267), reviews progress at mission_checkpoints (0268),
-- logs replan events at mission_drift_log (0270), and writes a final
-- mission_outcome (0269) on completion / abandonment.
--
-- Soft pointers (TEXT, not FK):
--   * owner_persona_id   → personas (Piece D — persona registry, 0150)
--   * audit_chain_id     → ai_audit_chain.id (0037 / 0127)
--
-- Real FKs:
--   * tenant_id          → tenants(id) ON DELETE CASCADE
--   * assigned_by_user_id→ users(id)
--
-- Numeric / monetary columns use minor units (cents / shilingi) so the
-- cost-ledger integration stays integer-only.
--
-- RLS: gold-standard pattern from 0182 / 0183 / 0184 / 0185 (ENABLE +
-- FORCE, tenant_isolation_select / _modify policies via
-- public.current_app_tenant_id(), REVOKE ALL FROM anon).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. agency_missions table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agency_missions (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assigned_by_user_id      TEXT NOT NULL REFERENCES users(id),
  /** Soft pointer to personas (Piece D / 0150_persona_registry.sql). */
  owner_persona_id         TEXT,
  title                    TEXT NOT NULL,
  goal                     TEXT NOT NULL,
  /** Inputs, constraints, success criteria. Free-form so callers can
      attach extra context without schema churn. */
  context_jsonb            JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_completion_date DATE,
  /** Risk tier — drives autonomy gating + audit retention. */
  risk_tier                TEXT NOT NULL DEFAULT 'MEDIUM',
  /** Autonomy tier — HITL_HIGH (every step), HITL_MEDIUM (key steps),
      HITL_LOW (only flagged), AUTONOMOUS (only emergency stops). */
  autonomy_tier            TEXT NOT NULL DEFAULT 'HITL_HIGH',
  status                   TEXT NOT NULL DEFAULT 'planning',
  /** Cost budget for LLM + external services (minor units of tenant
      currency). NULL = no explicit cap (the platform cost-ledger still
      enforces tenant-level limits). */
  budget_minor_units       BIGINT,
  spent_minor_units        BIGINT NOT NULL DEFAULT 0,
  /** Soft references to core_entity ids the mission is operating on
      (parcels, units, leases, …). */
  asset_refs               TEXT[] NOT NULL DEFAULT '{}',
  /** Soft pointer to ai_audit_chain.id (0037 / 0127). */
  audit_chain_id           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ,
  CONSTRAINT agency_missions_risk_tier_chk
    CHECK (risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'SOVEREIGN')),
  CONSTRAINT agency_missions_autonomy_tier_chk
    CHECK (autonomy_tier IN ('HITL_HIGH', 'HITL_MEDIUM', 'HITL_LOW', 'AUTONOMOUS')),
  CONSTRAINT agency_missions_status_chk
    CHECK (status IN ('planning', 'active', 'paused', 'completed', 'abandoned', 'escalated')),
  CONSTRAINT agency_missions_spent_nonneg
    CHECK (spent_minor_units >= 0),
  CONSTRAINT agency_missions_budget_nonneg
    CHECK (budget_minor_units IS NULL OR budget_minor_units >= 0)
);

CREATE INDEX IF NOT EXISTS idx_agency_missions_tenant_status
  ON agency_missions (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agency_missions_tenant_persona
  ON agency_missions (tenant_id, owner_persona_id)
  WHERE owner_persona_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agency_missions_tenant_due
  ON agency_missions (tenant_id, expected_completion_date)
  WHERE expected_completion_date IS NOT NULL
    AND status IN ('planning', 'active', 'paused');

COMMENT ON TABLE agency_missions IS
  'Piece Q — long-horizon mission header. Multi-day / multi-week agentic goal pursued by the brain. Decomposed into ordered mission_steps; reviewed at mission_checkpoints; closed by mission_outcomes.';

COMMENT ON COLUMN agency_missions.owner_persona_id IS
  'Soft pointer to personas (Piece D / 0150_persona_registry.sql). T1 / T2 personas typically own the mission and receive the weekly brief.';

COMMENT ON COLUMN agency_missions.audit_chain_id IS
  'Soft pointer to ai_audit_chain.id. Every step transition + drift event extends this chain so the mission has a hash-chained provenance record.';

COMMENT ON COLUMN agency_missions.risk_tier IS
  'LOW / MEDIUM / HIGH / SOVEREIGN. Drives autonomy gating: AUTONOMOUS execution is only legal for LOW (and explicitly opted-in MEDIUM with HITL_LOW).';

COMMENT ON COLUMN agency_missions.autonomy_tier IS
  'HITL_HIGH (every step approved), HITL_MEDIUM (key steps), HITL_LOW (only flagged), AUTONOMOUS (only emergency stops).';

COMMENT ON COLUMN agency_missions.asset_refs IS
  'TEXT[] of core_entity ids (parcels, units, leases, etc.) the mission is operating on. Soft references — no FK to keep cross-tenant moves cheap.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern (matches 0182 / 0183 / 0184 / 0185).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'agency_missions'
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

-- Operator note: long-running missions can sit in `planning` for a few
-- hours while the kernel decomposes the goal. Production cron should
-- only auto-activate missions whose ALL mission_steps have status =
-- 'pending' (i.e. the decomposer finished cleanly).
