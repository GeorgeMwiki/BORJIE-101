-- =============================================================================
-- 0033: AI cost ledger + per-tenant monthly budget — Wave 9 enterprise polish
-- =============================================================================
-- Track every LLM call (append-only) so operators can:
--   - Bill tenants or report ROI
--   - Enforce monthly budget caps and throw before expensive calls
--
-- Cost is stored as microdollars (USD / 1_000_000) to avoid float drift.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_cost_entries (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,          -- 'anthropic' | 'openai' | ...
  model             TEXT NOT NULL,          -- model id string
  input_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens     INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cost_usd_micro    BIGINT NOT NULL DEFAULT 0 CHECK (cost_usd_micro >= 0),
  operation         TEXT,                   -- optional caller hint (e.g. 'triage')
  correlation_id    TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_cost_tenant_time
  ON ai_cost_entries(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_cost_tenant_model
  ON ai_cost_entries(tenant_id, model);

CREATE TABLE IF NOT EXISTS tenant_ai_budgets (
  tenant_id            TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  monthly_cap_usd_micro BIGINT NOT NULL DEFAULT 0 CHECK (monthly_cap_usd_micro >= 0),
  hard_stop            BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
