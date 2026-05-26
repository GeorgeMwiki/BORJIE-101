-- =============================================================================
-- Migration 0035 — Five-Layer Loop Architecture schema (Wave M3-M4)
--
-- Companion to Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md. Adds
-- three tables forming the persistent provenance for every loop
-- executed by the platform. Every loop in Borjie passes through five
-- layers (sensors, policy, tools, quality, learning); each run records
-- one row per layer plus N rows of quality signals, chained by hash
-- against the previous run so the entire history is tamper-evident.
--
--   1. loop_runs              — one row per end-to-end loop execution.
--                               Captures kind, tenant, timing, status,
--                               and the hash-chain pointers. Tenant-
--                               scoped, RLS.
--   2. loop_layer_outcomes    — one row per executed layer
--                               (sensors / policy / tools / quality /
--                               learning). Captures the layer's typed
--                               outcome jsonb, latency, cost, and a
--                               row-local audit hash. Tenant-scoped via
--                               loop_runs.tenant_id, RLS.
--   3. loop_quality_signals   — one row per quality signal emitted by
--                               the Layer 4 composite gate. Captures
--                               the signal name, score, weight, and
--                               evidence payload. Tenant-scoped via
--                               loop_runs.tenant_id, RLS.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. loop_runs — one row per end-to-end loop execution
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS loop_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  loop_kind       text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  status          text NOT NULL DEFAULT 'running',
  audit_hash      text NOT NULL,
  prev_hash       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_runs_status_chk CHECK (status IN (
    'running',
    'ok',
    'no_input',
    'denied',
    'gated',
    'tool_error',
    'quality_failed',
    'learning_error'
  ))
);

CREATE INDEX IF NOT EXISTS idx_loop_runs_tenant_started
  ON loop_runs (tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_loop_runs_kind
  ON loop_runs (tenant_id, loop_kind, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_loop_runs_open
  ON loop_runs (tenant_id, status)
  WHERE status = 'running';

ALTER TABLE loop_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'loop_runs'
       AND policyname = 'loop_runs_tenant_isolation'
  ) THEN
    CREATE POLICY loop_runs_tenant_isolation ON loop_runs
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. loop_layer_outcomes — one row per executed layer
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS loop_layer_outcomes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_run_id     uuid NOT NULL REFERENCES loop_runs(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL,
  layer           text NOT NULL,
  outcome         jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms      integer NOT NULL DEFAULT 0,
  cost_usd_cents  integer NOT NULL DEFAULT 0,
  audit_hash      text NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_layer_outcomes_layer_chk CHECK (layer IN (
    'sensors',
    'policy',
    'tools',
    'quality',
    'learning'
  )),
  CONSTRAINT loop_layer_outcomes_latency_nonneg CHECK (latency_ms >= 0),
  CONSTRAINT loop_layer_outcomes_cost_nonneg CHECK (cost_usd_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_loop_layer_outcomes_run
  ON loop_layer_outcomes (loop_run_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_loop_layer_outcomes_tenant_layer
  ON loop_layer_outcomes (tenant_id, layer, recorded_at DESC);

ALTER TABLE loop_layer_outcomes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'loop_layer_outcomes'
       AND policyname = 'loop_layer_outcomes_tenant_isolation'
  ) THEN
    CREATE POLICY loop_layer_outcomes_tenant_isolation ON loop_layer_outcomes
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. loop_quality_signals — one row per gate signal in Layer 4
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS loop_quality_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_run_id     uuid NOT NULL REFERENCES loop_runs(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL,
  signal          text NOT NULL,
  score           real NOT NULL,
  weight          real NOT NULL DEFAULT 1.0,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loop_quality_signals_score_range CHECK (score >= 0 AND score <= 1),
  CONSTRAINT loop_quality_signals_weight_nonneg CHECK (weight >= 0)
);

CREATE INDEX IF NOT EXISTS idx_loop_quality_signals_run
  ON loop_quality_signals (loop_run_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_loop_quality_signals_signal
  ON loop_quality_signals (tenant_id, signal, recorded_at DESC);

ALTER TABLE loop_quality_signals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'loop_quality_signals'
       AND policyname = 'loop_quality_signals_tenant_isolation'
  ) THEN
    CREATE POLICY loop_quality_signals_tenant_isolation ON loop_quality_signals
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
