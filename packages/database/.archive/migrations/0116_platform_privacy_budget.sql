-- ─────────────────────────────────────────────────────────────────────
-- Migration 0116 — Platform privacy-budget ledger.
--
-- Persistence backing for `@borjie/graph-privacy`'s
-- `PlatformBudgetLedger` port. Replaces the in-memory ledger so cohort
-- DP-aggregator budget consumption survives api-gateway restarts.
--
-- Two tables:
--   platform_privacy_budget
--     Single-row table (primary key = 'singleton') holding the
--     configured ε / δ totals and the cumulative spend.
--   platform_privacy_budget_reservations
--     Append-only audit log; one row per successful reserve() call.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_privacy_budget (
  id             TEXT PRIMARY KEY,
  total_epsilon  DOUBLE PRECISION NOT NULL,
  spent_epsilon  DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_delta    DOUBLE PRECISION NOT NULL,
  spent_delta    DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_privacy_budget_reservations (
  id           TEXT PRIMARY KEY,
  epsilon      DOUBLE PRECISION NOT NULL,
  delta        DOUBLE PRECISION NOT NULL,
  reserved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_privacy_budget_reservations_reserved_at
  ON platform_privacy_budget_reservations (reserved_at);

COMMENT ON TABLE platform_privacy_budget IS
  'Singleton budget row (id = ''singleton'') for the platform-level DP budget consumed by cross-tenant cohort aggregates. Backs the @borjie/graph-privacy PlatformBudgetLedger port.';

COMMENT ON TABLE platform_privacy_budget_reservations IS
  'Append-only audit log; one row per successful PlatformBudgetLedger.reserve() call. Companion to platform_privacy_budget.';
