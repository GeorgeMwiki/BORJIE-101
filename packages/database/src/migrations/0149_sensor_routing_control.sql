-- ─────────────────────────────────────────────────────────────────────
-- Migration 0149 — Sensor routing control plane (Phase D D7 extension).
--
-- Builds on migration 0126 (sensor_call_log + tenant_budget_envelopes)
-- by adding the two missing tables of the LITFIN-parity control plane:
--
--   - task_sensor_routing  — per-(tenant, task) sensor-chain overrides
--                            so admins can pin Opus / pin Sonnet /
--                            drain a sensor for a specific tenant
--                            without a deploy.
--
--   - sensor_catalog       — registry of every LLM sensor the brain
--                            can call (provider + model + tier +
--                            pricing). Replaces the hard-coded
--                            HAIKU/SONNET/OPUS constants with a DB
--                            substrate; new sensors appear without a
--                            deploy.
--
-- Costs are BIGINT microdollars (1 USD = 1_000_000) — never floats.
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS guards. Safe to
-- re-run.
-- ─────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────
-- task_sensor_routing — per-(tenant, task) chain override.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_sensor_routing (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT,
  task            TEXT NOT NULL,
  chain           JSONB NOT NULL,
  cognition_mode  TEXT NOT NULL DEFAULT 'default',
  reasoning       TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_task_sensor_routing_cognition_mode CHECK (
    cognition_mode IN ('fast', 'default', 'deep')
  ),
  CONSTRAINT ck_task_sensor_routing_task_nonempty CHECK (length(task) > 0),
  CONSTRAINT ck_task_sensor_routing_chain_array CHECK (
    jsonb_typeof(chain) = 'array' AND jsonb_array_length(chain) >= 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_sensor_routing_tenant_task
  ON task_sensor_routing (tenant_id, task);

CREATE INDEX IF NOT EXISTS idx_task_sensor_routing_task
  ON task_sensor_routing (task);

COMMENT ON TABLE task_sensor_routing IS
  'DB-stored per-(tenant, task) sensor-chain override. NULL tenant_id is a platform-wide default override. The brain router reads this first and falls back to the in-code builtin chain on miss.';

-- ─────────────────────────────────────────────────────────────────────
-- sensor_catalog — registry of every LLM sensor the brain can call.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sensor_catalog (
  id                                  TEXT PRIMARY KEY,
  provider                            TEXT NOT NULL,
  model                               TEXT NOT NULL,
  display_name                        TEXT NOT NULL,
  tier                                TEXT NOT NULL DEFAULT 'standard',
  default_max_budget_usd_micro_per_call BIGINT NOT NULL DEFAULT 0,
  default_max_tokens                  INTEGER NOT NULL DEFAULT 2000,
  pricing_input_usd_micro_per_1m      BIGINT NOT NULL DEFAULT 0,
  pricing_output_usd_micro_per_1m     BIGINT NOT NULL DEFAULT 0,
  active                              BOOLEAN NOT NULL DEFAULT TRUE,
  metadata                            JSONB,
  created_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_sensor_catalog_tier CHECK (
    tier IN ('basic', 'standard', 'advanced')
  ),
  CONSTRAINT ck_sensor_catalog_budget_nonneg CHECK (
    default_max_budget_usd_micro_per_call >= 0
    AND pricing_input_usd_micro_per_1m >= 0
    AND pricing_output_usd_micro_per_1m >= 0
  ),
  CONSTRAINT ck_sensor_catalog_tokens_pos CHECK (default_max_tokens >= 1)
);

CREATE INDEX IF NOT EXISTS idx_sensor_catalog_provider
  ON sensor_catalog (provider);

CREATE INDEX IF NOT EXISTS idx_sensor_catalog_active_tier
  ON sensor_catalog (active, tier);

COMMENT ON TABLE sensor_catalog IS
  'Registry of every LLM sensor the brain can call. Provider + model + tier + pricing. active=false drains the sensor from every routing chain without a deploy.';
