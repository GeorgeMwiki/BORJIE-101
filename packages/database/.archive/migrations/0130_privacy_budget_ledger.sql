-- ─────────────────────────────────────────────────────────────────────
-- Migration 0130 — Per-tenant privacy-budget ledger (K6.2).
--
-- Closes parity-gap G2: the `platform_privacy_budget` table is a
-- singleton tracking platform-wide cohort spend, but per-tenant DP
-- queries (cross-tenant-query.ts) lacked a persisted composition view.
-- This migration adds the tenant-scoped ledger so the
-- PrivacyBudgetComposerService can refuse spend across both surfaces
-- without an attacker compounding effective ε by alternating.
--
-- Two tables:
--   privacy_budget_ledger
--     One row per (tenant_id, window_start). Holds the cumulative
--     (ε, δ) spend for the 30-day rolling window. UNIQUE constraint
--     prevents accidental duplicate windows.
--   privacy_budget_spend
--     Append-only audit log; one row per recordSpend() call. Lets
--     compliance auditors reconstruct which queries consumed budget.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_budget_ledger (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL,
  tier            TEXT NOT NULL,
  window_start    TIMESTAMPTZ NOT NULL,
  total_epsilon   DOUBLE PRECISION NOT NULL,
  total_delta     DOUBLE PRECISION NOT NULL,
  spent_epsilon   DOUBLE PRECISION NOT NULL DEFAULT 0,
  spent_delta     DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_privacy_budget_tenant_window
  ON privacy_budget_ledger (tenant_id, window_start);

CREATE INDEX IF NOT EXISTS idx_privacy_budget_ledger_tenant
  ON privacy_budget_ledger (tenant_id);

CREATE TABLE IF NOT EXISTS privacy_budget_spend (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  query_id      TEXT NOT NULL,
  epsilon       DOUBLE PRECISION NOT NULL,
  delta         DOUBLE PRECISION NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  spent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_budget_spend_tenant
  ON privacy_budget_spend (tenant_id);

CREATE INDEX IF NOT EXISTS idx_privacy_budget_spend_spent_at
  ON privacy_budget_spend (spent_at);

COMMENT ON TABLE privacy_budget_ledger IS
  'Per-tenant (ε, δ) privacy-budget ledger over a 30-day rolling window. Backs PrivacyBudgetComposerService. Hard caps by tier: platform 5.0, pro 10.0, enterprise 50.0 (δ = 1e-5 across tiers).';

COMMENT ON TABLE privacy_budget_spend IS
  'Append-only audit log; one row per recordSpend(). Companion to privacy_budget_ledger.';
