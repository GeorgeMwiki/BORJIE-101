-- ============================================================================
-- BUG-HI-3: Postgres-backed LLM budget store.
--
-- Two tables back the `@borjie/llm-budget-governor` `BudgetStore`
-- interface:
--
--   tenant_llm_budgets       per-period spend (one row per tenant per
--                            period_kind per period_start window)
--   tenant_llm_budget_caps   per-tenant cap configuration (cents, tokens,
--                            allowed tiers, downgrade threshold)
--
-- Separating caps from usage keeps the per-period rows narrow and lets
-- caps roll forward across period changes without churning the usage
-- rows.
--
-- Atomic increment lives on the usage table via
--   INSERT ... ON CONFLICT (tenant_id, period_kind, period_start)
--     DO UPDATE SET spend_tokens = spend_tokens + EXCLUDED.spend_tokens,
--                   spend_cents  = spend_cents  + EXCLUDED.spend_cents
-- so concurrent calls never lose spend.
-- ============================================================================

-- Per-period usage --------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_llm_budgets (
  tenant_id          text        NOT NULL,
  period_kind        text        NOT NULL CHECK (period_kind IN ('daily', 'monthly')),
  period_start       timestamptz NOT NULL,
  period_end         timestamptz NOT NULL,
  spend_tokens       bigint      NOT NULL DEFAULT 0 CHECK (spend_tokens >= 0),
  spend_cents        bigint      NOT NULL DEFAULT 0 CHECK (spend_cents  >= 0),
  highest_tier_used  text        NULL CHECK (highest_tier_used IS NULL OR highest_tier_used IN ('haiku', 'sonnet', 'opus')),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period_kind, period_start)
);

-- Lookup index for "current period for tenant" reads + future cleanup
-- jobs (`WHERE period_end < now() - interval ...`).
CREATE INDEX IF NOT EXISTS tenant_llm_budgets_tenant_period_idx
  ON tenant_llm_budgets (tenant_id, period_kind, period_end DESC);

-- Per-tenant cap configuration -------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_llm_budget_caps (
  tenant_id              text NOT NULL PRIMARY KEY,
  period_kind            text NOT NULL CHECK (period_kind IN ('daily', 'monthly')),
  cap_cents              bigint NOT NULL CHECK (cap_cents > 0),
  cap_tokens             bigint NOT NULL CHECK (cap_tokens > 0),
  allowed_tiers          text[] NOT NULL CHECK (array_length(allowed_tiers, 1) >= 1),
  downgrade_at_fraction  numeric(4, 3) NOT NULL DEFAULT 0.85
                         CHECK (downgrade_at_fraction > 0 AND downgrade_at_fraction <= 1),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
