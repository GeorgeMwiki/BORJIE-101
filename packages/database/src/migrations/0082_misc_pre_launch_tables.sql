-- =============================================================================
-- Migration 0082 — Pre-Launch Misc Tables (Wave PRE-LAUNCH-MISC)
--
-- Companion to:
--   - services/api-gateway/src/routes/mining/cockpit.hono.ts (sic-pings, decisions)
--   - services/api-gateway/src/routes/mining/csr-plans.hono.ts
--   - services/api-gateway/src/routes/mining/incidents.hono.ts (close-out)
--   - services/api-gateway/src/routes/mining/reports.hono.ts (share)
--   - services/api-gateway/src/routes/currency-rates.hono.ts
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Three additions:
--
--   1) ALTER TABLE incidents — add close-out columns (closed_at,
--      closed_by_user_id, closure_reason) so safety incidents have an
--      auditable terminal state. Idempotent via DO blocks.
--
--   2) ALTER TABLE csr_plans — add a derived delivered_pct column so
--      cockpit / owner-web can read commitment delivery without a
--      per-row recompute. GENERATED ALWAYS AS, fully derived from
--      (budget_tzs, spent_tzs).
--
--   3) mining_sic_pings — Short Interval Control (SIC) periodic check-ins
--      from supervisors on hot shifts. Tenant-scoped, RLS-forced. Empty
--      by default — backfill via the supervisor-mobile cron.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern. RLS is FORCE-enabled per the Borjie hard rule
-- (`CLAUDE.md`) so the policy applies to table owners too.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- (1) incidents — closure columns
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'incidents'
       AND column_name  = 'closed_at'
  ) THEN
    ALTER TABLE incidents ADD COLUMN closed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'incidents'
       AND column_name  = 'closed_by_user_id'
  ) THEN
    ALTER TABLE incidents ADD COLUMN closed_by_user_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'incidents'
       AND column_name  = 'closure_reason'
  ) THEN
    ALTER TABLE incidents ADD COLUMN closure_reason text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'incidents_closure_consistency_chk'
  ) THEN
    -- A closed incident MUST have closed_at + closed_by_user_id;
    -- an open/non-closed status MUST NOT carry closed_at.
    ALTER TABLE incidents
      ADD CONSTRAINT incidents_closure_consistency_chk
      CHECK (
        (status = 'closed' AND closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)
        OR (status <> 'closed' AND closed_at IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_closed_at
  ON incidents (tenant_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- (2) csr_plans — derived delivered_pct column
-- -----------------------------------------------------------------------------
--
-- delivered_pct = round((spent_tzs / NULLIF(budget_tzs, 0)) * 100, 2)
-- Bounded to [0, 100] so over-runs do not break dashboard color scales.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'csr_plans'
       AND column_name  = 'delivered_pct'
  ) THEN
    ALTER TABLE csr_plans
      ADD COLUMN delivered_pct numeric(5, 2)
      GENERATED ALWAYS AS (
        LEAST(
          100.00,
          GREATEST(
            0.00,
            ROUND(
              (COALESCE(spent_tzs, 0) / NULLIF(budget_tzs, 0)) * 100,
              2
            )
          )
        )
      ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_csr_plans_tenant_delivered_pct
  ON csr_plans (tenant_id, delivered_pct DESC);

-- -----------------------------------------------------------------------------
-- (3) mining_sic_pings — Short Interval Control periodic check-ins
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mining_sic_pings (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  site_id              uuid,
  /** Supervisor who emitted the ping. */
  pinged_by_user_id    uuid        NOT NULL,
  /** Ping ISO timestamp. */
  pinged_at            timestamptz NOT NULL DEFAULT now(),
  /** ok|delay|stop|safety_concern|equipment_down|other. */
  status               text        NOT NULL DEFAULT 'ok',
  /** Free-text note (Swahili-first). */
  note_sw              text,
  /** Optional KPI snapshot at the moment of the ping. */
  kpi_snapshot         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_sic_pings_status_chk'
  ) THEN
    ALTER TABLE mining_sic_pings
      ADD CONSTRAINT mining_sic_pings_status_chk
      CHECK (status IN ('ok', 'delay', 'stop', 'safety_concern', 'equipment_down', 'other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_sic_pings_kpi_is_object_chk'
  ) THEN
    ALTER TABLE mining_sic_pings
      ADD CONSTRAINT mining_sic_pings_kpi_is_object_chk
      CHECK (jsonb_typeof(kpi_snapshot) = 'object');
  END IF;
END $$;

-- Hot path: per-tenant queue, newest first.
CREATE INDEX IF NOT EXISTS idx_mining_sic_pings_tenant_pinged_at
  ON mining_sic_pings (tenant_id, pinged_at DESC);

-- Per-site queue.
CREATE INDEX IF NOT EXISTS idx_mining_sic_pings_tenant_site
  ON mining_sic_pings (tenant_id, site_id, pinged_at DESC);

-- Per-status drill-downs.
CREATE INDEX IF NOT EXISTS idx_mining_sic_pings_tenant_status
  ON mining_sic_pings (tenant_id, status, pinged_at DESC);

ALTER TABLE mining_sic_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE mining_sic_pings FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mining_sic_pings'
       AND policyname = 'mining_sic_pings_tenant_isolation'
  ) THEN
    CREATE POLICY mining_sic_pings_tenant_isolation
      ON mining_sic_pings
      FOR ALL
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
