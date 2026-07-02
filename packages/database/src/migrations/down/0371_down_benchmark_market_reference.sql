-- =============================================================================
-- Down-migration 0371 — drop the three market-reference tables.
--
-- Dev/staging only — DATA LOSS on the three market tables. Drops the tables
-- created by 0371 (bot_gold_windows / lbma_fix_summary / fx_rates_intraday —
-- tables + indexes + RLS policies fall with them). Only for a clean
-- apply→reverse test on a throwaway DB; never run against an environment with
-- real state.
--
-- The additive external_benchmarks / peer_cohort_aggregates seed rows are NOT
-- reversed: those tables are owned by migration 0095, and the seeded scanner
-- metric_ids are harmless additional reference rows (ON CONFLICT DO NOTHING).
-- Leaving them is safe and re-applying 0371 is idempotent.
--
-- Reverses migration 0371_benchmark_market_reference.sql.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS bot_gold_windows CASCADE;
DROP TABLE IF EXISTS lbma_fix_summary CASCADE;
DROP TABLE IF EXISTS fx_rates_intraday CASCADE;

COMMIT;
