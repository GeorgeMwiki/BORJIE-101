-- ─────────────────────────────────────────────────────────────────────
-- Migration 0154 — Alternative-data tenant credit scores.
--
-- Phase D D10 — Comprehensive Gap Closure (Sub-feature 4 of 6).
--
-- Stores the score produced by the alt-data credit model — the model
-- combines M-Pesa cash-flow signal (transaction frequency +
-- recipient diversity) + utility-payment-on-time rate + employer-payroll
-- regularity into a single 0-1000 score with a band classification.
--
-- This is SEPARATE from the existing `tenant_credit_ratings` table
-- (which holds the rent-payment-history-driven rating computed by
-- `packages/ai-copilot/src/credit-rating/`). The alt-data score
-- INFORMS the screening risk model — it's pre-lease signal where the
-- rent-history rating has no data yet (new tenants).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS alt_credit_scores (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   TEXT NOT NULL,
  customer_id                 TEXT NOT NULL,

  -- Score in [0, 1000]. Same scale as the rent-history credit score
  -- so downstream consumers can blend them with a simple weighted avg.
  score                       INTEGER NOT NULL,
  band                        TEXT NOT NULL CHECK (band IN ('poor', 'fair', 'good', 'excellent')),

  -- Component sub-scores (each 0-1000, normalised).
  mpesa_cashflow_score        INTEGER NOT NULL,
  utility_ontime_score        INTEGER NOT NULL,
  payroll_regularity_score    INTEGER NOT NULL,

  -- Raw inputs the score was computed from (audit trail).
  mpesa_tx_count_30d          INTEGER NOT NULL,
  mpesa_distinct_recipients   INTEGER NOT NULL,
  utility_payments_observed   INTEGER NOT NULL,
  utility_payments_on_time    INTEGER NOT NULL,
  payroll_periods_observed    INTEGER NOT NULL,
  payroll_periods_on_schedule INTEGER NOT NULL,

  -- Model bookkeeping.
  model_version               TEXT NOT NULL,
  as_of                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  computed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Append-only. Latest row per (tenant, customer) wins downstream.
  CONSTRAINT alt_credit_scores_score_range CHECK (score BETWEEN 0 AND 1000),
  CONSTRAINT alt_credit_scores_subs_range CHECK (
    mpesa_cashflow_score BETWEEN 0 AND 1000
    AND utility_ontime_score BETWEEN 0 AND 1000
    AND payroll_regularity_score BETWEEN 0 AND 1000
  )
);

CREATE INDEX IF NOT EXISTS idx_alt_credit_scores_tenant_customer
  ON alt_credit_scores (tenant_id, customer_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_alt_credit_scores_band
  ON alt_credit_scores (tenant_id, band);
