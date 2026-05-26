-- Phase E.4 — Autonomy Governance (the Klarna defense substrate).
--
-- Three tables:
--
--   1. tenant_autonomy_caps   per-tenant daily autonomy envelope; the
--                              kernel checks `evaluateAutonomyCap`
--                              against this BEFORE every mutate-tier
--                              tool action.
--   2. sub_md_slos             per-(subMd, tenantId, metric) quality
--                              SLO definition with canary stage +
--                              breach action.
--   3. sub_md_slo_events       outcome log streamed in from the
--                              sensorium; consumed by the SLO monitor.
--
-- See:
--   packages/database/src/schemas/autonomy-caps.schema.ts
--   packages/database/src/schemas/sub-md-slo.schema.ts
--   packages/autonomy-governance/src/

-- ─────────────────────────────────────────────────────────────────────
-- 1. tenant_autonomy_caps
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_autonomy_caps (
  tenant_id                 text        PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  max_mutations_per_day     integer     NOT NULL DEFAULT 50,
  max_cost_usd_cents_per_day bigint     NOT NULL DEFAULT 500000,
  -- JSONB { "<RiskTier>": number | null }. null = unlimited; 0 = blocked.
  per_tool_tier_caps        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- JSONB { "<subMd>": { maxMutationsPerDay, maxCostUsdCentsPerDay } }.
  per_sub_md_caps           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  slowdown_at               numeric(3,2) NOT NULL DEFAULT 0.80,
  hard_stop_at              numeric(3,2) NOT NULL DEFAULT 1.00,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                text        NOT NULL,

  CONSTRAINT tenant_autonomy_caps_mutations_chk
    CHECK (max_mutations_per_day >= 0),
  CONSTRAINT tenant_autonomy_caps_cost_chk
    CHECK (max_cost_usd_cents_per_day >= 0),
  CONSTRAINT tenant_autonomy_caps_slowdown_chk
    CHECK (slowdown_at > 0 AND slowdown_at <= 1),
  CONSTRAINT tenant_autonomy_caps_hard_stop_chk
    CHECK (hard_stop_at > 0 AND hard_stop_at <= 1),
  CONSTRAINT tenant_autonomy_caps_slowdown_leq_hardstop_chk
    CHECK (slowdown_at <= hard_stop_at)
);

COMMENT ON TABLE tenant_autonomy_caps IS
  'Phase E.4 — Per-tenant daily autonomy envelope. The kernel must consult evaluateAutonomyCap against this row BEFORE any mutate-tier tool action. Missing row = platform defaults.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. sub_md_slos
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sub_md_slos (
  sub_md         text        NOT NULL,
  tenant_id      text        REFERENCES tenants(id) ON DELETE CASCADE,
  metric         text        NOT NULL,
  target         numeric(12,6) NOT NULL,
  window         text        NOT NULL,
  breach_action  text        NOT NULL,
  canary_stage   text        NOT NULL DEFAULT 'shadow',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Composite primary key. Note: tenant_id may be NULL (platform
  -- default). Postgres treats NULLs as distinct in PRIMARY KEY, but
  -- application-layer guards forbid more than one (sub_md, NULL,
  -- metric) row per (sub_md, metric) pair.
  PRIMARY KEY (sub_md, tenant_id, metric),

  CONSTRAINT sub_md_slos_breach_action_chk
    CHECK (breach_action IN ('warn', 'reduce-traffic', 'handoff', 'kill-and-rollback')),
  CONSTRAINT sub_md_slos_window_chk
    CHECK (window IN ('rolling-24h', 'rolling-7d', 'rolling-30d')),
  CONSTRAINT sub_md_slos_canary_stage_chk
    CHECK (canary_stage IN ('shadow', 'canary-1pct', 'canary-5pct', 'canary-25pct', 'live')),
  CONSTRAINT sub_md_slos_metric_chk
    CHECK (metric IN ('resolution-quality', 'task-completion-rate', 'owner-cs-score', 'cost-per-resolution'))
);

CREATE INDEX IF NOT EXISTS idx_sub_md_slos_metric
  ON sub_md_slos (sub_md, metric);
CREATE INDEX IF NOT EXISTS idx_sub_md_slos_tenant
  ON sub_md_slos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_sub_md_slos_canary
  ON sub_md_slos (canary_stage);

-- One platform-default row per (sub_md, metric). Enforced via partial
-- unique index because Postgres allows multiple NULLs in a UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_md_slos_platform_default
  ON sub_md_slos (sub_md, metric)
  WHERE tenant_id IS NULL;

COMMENT ON TABLE sub_md_slos IS
  'Phase E.4 — Per-sub-MD quality SLO. NULL tenant_id = platform default; per-tenant rows override. Breach actions: warn / reduce-traffic / handoff / kill-and-rollback.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. sub_md_slo_events
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sub_md_slo_events (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_md          text         NOT NULL,
  tenant_id       text         REFERENCES tenants(id) ON DELETE CASCADE,
  timestamp       timestamptz  NOT NULL DEFAULT now(),
  metric          text         NOT NULL,
  actual_value    numeric(14,6) NOT NULL,
  predicted_value numeric(14,6),
  -- Signed delta: actual - target for higher-is-better metrics, or
  -- target - actual for lower-is-better metrics. Negative = breach.
  delta           numeric(14,6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sub_md_slo_events_sub_md_time
  ON sub_md_slo_events (sub_md, metric, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sub_md_slo_events_tenant_time
  ON sub_md_slo_events (tenant_id, timestamp DESC);

COMMENT ON TABLE sub_md_slo_events IS
  'Phase E.4 — Per-sub-MD outcome log. Streamed in from sensorium after each sub-MD run terminates; consumed by the SLO monitor (`evaluateSlo`) which decides whether to fire a breach action.';
