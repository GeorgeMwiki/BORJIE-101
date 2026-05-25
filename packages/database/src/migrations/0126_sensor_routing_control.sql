-- ─────────────────────────────────────────────────────────────────────
-- Migration 0126 — Sensor routing control plane (LITFIN parity).
--
-- Closes the top-1 gap from .planning/parity-litfin/04-sensors-routing.md:
-- the brain has no DB-backed routing telemetry and no per-tenant period-
-- bound dollar envelope. Two append-only tables form the control plane:
--
--   - sensor_call_log
--       One row per (task, sensor) attempt. `outcome` ∈
--       {ok | timeout | error | budget_exceeded | refused} so
--       ops-dashboards can split availability from cost-control from
--       refusal. tokens_in / tokens_out / cost_usd_micro keep the
--       dollar trail; latency_ms + thinking_active let us tune the
--       cognition-mode hints.
--
--   - tenant_budget_envelopes
--       Period-bound USD ceiling per tenant (typically UTC month).
--       hard_cap_enforced=true makes the router refuse calls that
--       would breach the ceiling; alert_threshold_pct fires the
--       warning webhook once utilisation crosses the line.
--
-- Costs are BIGINT microdollars (1 USD = 1_000_000) — never floats.
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS guards.
-- Safe to re-run on an existing schema.
-- ─────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────
-- sensor_call_log
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sensor_call_log (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT,
  task              TEXT NOT NULL,
  sensor            TEXT NOT NULL,
  model             TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  outcome           TEXT NOT NULL,
  error_class       TEXT,
  tokens_in         INTEGER NOT NULL DEFAULT 0,
  tokens_out        INTEGER NOT NULL DEFAULT 0,
  cost_usd_micro    BIGINT NOT NULL DEFAULT 0,
  latency_ms        INTEGER,
  thinking_active   BOOLEAN NOT NULL DEFAULT FALSE,
  decision_trace_id TEXT,
  CONSTRAINT ck_sensor_call_log_outcome CHECK (
    outcome IN ('ok', 'timeout', 'error', 'budget_exceeded', 'refused')
  ),
  CONSTRAINT ck_sensor_call_log_tokens_nonneg CHECK (
    tokens_in >= 0 AND tokens_out >= 0
  ),
  CONSTRAINT ck_sensor_call_log_cost_nonneg CHECK (cost_usd_micro >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sensor_call_log_tenant_time
  ON sensor_call_log (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_call_log_task_sensor
  ON sensor_call_log (task, sensor, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_call_log_outcome
  ON sensor_call_log (outcome, started_at DESC);

COMMENT ON TABLE sensor_call_log IS
  'Append-only per-attempt telemetry for the multi-LLM sensor router. Outcome distinguishes ok / timeout / error / budget_exceeded / refused so ops dashboards can split availability, cost, and refusal failure modes. Debits tenant_budget_envelopes.consumed_usd_micro.';

-- ─────────────────────────────────────────────────────────────────────
-- tenant_budget_envelopes
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_budget_envelopes (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  period_start        TIMESTAMPTZ NOT NULL,
  period_end          TIMESTAMPTZ NOT NULL,
  budget_usd_micro    BIGINT NOT NULL DEFAULT 0,
  consumed_usd_micro  BIGINT NOT NULL DEFAULT 0,
  alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
  hard_cap_enforced   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_tenant_budget_envelopes_threshold CHECK (
    alert_threshold_pct >= 0 AND alert_threshold_pct <= 100
  ),
  CONSTRAINT ck_tenant_budget_envelopes_amounts CHECK (
    budget_usd_micro >= 0 AND consumed_usd_micro >= 0
  ),
  CONSTRAINT ck_tenant_budget_envelopes_period CHECK (
    period_end > period_start
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_budget_envelopes_tenant_period
  ON tenant_budget_envelopes (tenant_id, period_start);

CREATE INDEX IF NOT EXISTS idx_tenant_budget_envelopes_tenant
  ON tenant_budget_envelopes (tenant_id);

COMMENT ON TABLE tenant_budget_envelopes IS
  'Period-bound USD ceiling per tenant for the multi-LLM sensor router. budget_usd_micro is the cap, consumed_usd_micro is the cached debit total, hard_cap_enforced refuses calls that would breach, alert_threshold_pct fires the warning webhook once utilisation crosses the line.';
