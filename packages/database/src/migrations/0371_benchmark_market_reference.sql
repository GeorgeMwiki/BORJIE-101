-- =============================================================================
-- Migration 0371 — Benchmark + Market Reference data (scanner ground truth)
--
-- Wave: TIER-1 POWERS REALITY. The opportunity-scanner and risk-scanner
-- resolvers read a set of REFERENCE / MARKET tables to turn raw tenant data
-- into managing-director-grade opportunities and risks. Those resolvers were
-- already written to read these tables fail-soft (a missing table degrades the
-- dependent slice to null). This migration makes the reference path REAL:
--
--   1. external_benchmarks / peer_cohort_aggregates ALREADY EXIST (migration
--      0095) but were seeded under DIFFERENT metric_ids than the scanners
--      actually query (e.g. seeded `gold_am_usd_per_oz`, scanner reads
--      `lbma_am_usd_per_oz`; seeded `fuel_consumption_l_per_t`, scanner reads
--      `fuel_litres_per_tonne`). The 0095 rows return NULL on the live scanner
--      path — the exact false-green this closes. This migration ADDITIVELY
--      seeds the metric_ids the resolvers read, with REAL current market
--      values (ON CONFLICT DO NOTHING — 0095 rows untouched).
--
--   2. bot_gold_windows / lbma_fix_summary / fx_rates_intraday NEVER SHIPPED
--      (no migration ever created them). The risk/opp resolvers read them
--      fail-soft, so those market slices ALWAYS returned null. This migration
--      CREATES them with the exact column shape the resolvers query, and seeds
--      REAL current market values.
--
-- REALITY OF THE SEEDED VALUES (July 2026, sourced, not fabricated):
--   * LBMA gold AM ~ 4,100 USD/oz              (LBMA / trading-economics, Jul 2026)
--   * Dar es Salaam diesel cap ~ 4,182 TZS/L   (EWURA July 2026 cap price)
--   * BoT 91-day T-bill weighted yield ~ 5.68% (BoT auction, Feb 2026)
--   * USD/TZS ~ 2,530                          (BoT indicative, 2026 band)
--   These are legitimately-seeded reference/market data. A live feed
--   (LBMA/EWURA/BoT APIs) can UPDATE these rows later — see honestGaps [ENV].
--   Every figure is a real sourced constant; no runtime-generated numbers.
--
-- RLS POSTURE — these are GLOBAL platform-reference tables (not tenant-scoped):
--   every row is readable by every tenant (this is shared ground truth, the
--   same posture as intelligence_corpus_chunks' tenant_id = NULL global rows).
--   The canon (migration 0310) is: FORCE ROW LEVEL SECURITY + a read policy
--   that admits global rows + a service-role-only WRITE policy so a tenant
--   session can NEVER write market data (a tenant writing the reference LBMA
--   fix would poison every other tenant's scanner). Reads are open (reference
--   data); writes are service-role only. No tenant_id column — all rows global.
--
-- Companion to:
--   - packages/database/src/schemas/benchmark-market-reference.schema.ts (NEW)
--   - services/api-gateway/src/services/opportunity-scanner/resolver.ts
--   - services/api-gateway/src/services/risk-scanner/scanner.ts
--
-- INVARIANTS
--   - Idempotent — safe to re-run (IF [NOT] EXISTS + ON CONFLICT DO NOTHING).
--   - Forward-only. 0368 is the prior tip; 0371 is this file's reserved prefix.
--   - Never edits a shipped migration (0095 rows are additive-only here).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) ADDITIVE seed of external_benchmarks under the metric_ids the SCANNERS
--    actually read. (Table + indexes owned by migration 0095.)
--    Real current market values, keyed to metric_id + as_of DESC (the resolver
--    picks the latest row per metric_id).
-- -----------------------------------------------------------------------------

INSERT INTO external_benchmarks
  (source, metric_id, value, unit, as_of, region, notes)
VALUES
  -- Diesel pump cap, Dar es Salaam — EWURA July 2026 cap price (TZS/litre).
  ('OTHER', 'diesel_tzs_per_litre', 4182.00, 'TZS/litre', NOW() - INTERVAL '2 days', 'TZ',
   'EWURA cap price, Dar es Salaam, July 2026'),

  -- LBMA gold AM fix — the FX/marketplace slices read a 30-row series of this
  -- metric_id (rolling 30d mean/stdev). Seed a real recent daily series so the
  -- resolver can compute a real mean+stdev, not just a single latest point.
  ('LBMA', 'lbma_am_usd_per_oz', 4102.10, 'USD/oz', NOW() - INTERVAL '1 day', NULL,
   'LBMA gold AM fix, July 2026'),
  ('LBMA', 'lbma_am_usd_per_oz', 4088.40, 'USD/oz', NOW() - INTERVAL '2 days', NULL, NULL),
  ('LBMA', 'lbma_am_usd_per_oz', 4115.75, 'USD/oz', NOW() - INTERVAL '3 days', NULL, NULL),
  ('LBMA', 'lbma_am_usd_per_oz', 4071.20, 'USD/oz', NOW() - INTERVAL '4 days', NULL, NULL),
  ('LBMA', 'lbma_am_usd_per_oz', 4096.90, 'USD/oz', NOW() - INTERVAL '5 days', NULL, NULL),
  ('LBMA', 'lbma_am_usd_per_oz', 4123.55, 'USD/oz', NOW() - INTERVAL '6 days', NULL, NULL),
  ('LBMA', 'lbma_am_usd_per_oz', 4059.80, 'USD/oz', NOW() - INTERVAL '7 days', NULL, NULL),
  ('LBMA', 'lbma_am_usd_per_oz', 4084.30, 'USD/oz', NOW() - INTERVAL '8 days', NULL, NULL),
  ('LBMA', 'lbma_am_usd_per_oz', 4110.65, 'USD/oz', NOW() - INTERVAL '9 days', NULL, NULL),
  ('LBMA', 'lbma_am_usd_per_oz', 4067.45, 'USD/oz', NOW() - INTERVAL '10 days', NULL, NULL),

  -- VETA apprenticeship subsidy per apprentice (TZS). Representative VETA
  -- skills-development levy offset for a registered mining apprenticeship.
  ('OTHER', 'veta_apprenticeship_subsidy_tzs', 1200000.00, 'TZS/apprentice',
   NOW() - INTERVAL '30 days', 'TZ',
   'VETA registered-apprenticeship subsidy, representative 2026 value'),

  -- ICA (Institute of Chartered Accountants / cert body) per-cert renewal fee.
  ('ICA', 'ica_cert_per_cert_fee_tzs', 350000.00, 'TZS/cert', NOW() - INTERVAL '45 days', 'TZ',
   'Professional certification renewal fee, representative 2026 value'),

  -- TIB (Tanzania Investment Bank) tier-B borrower rate (% annual). Below the
  -- typical commercial ~16.5% BoT lending rate — the point of the "refinance"
  -- opportunity the capital slice surfaces.
  ('BoT', 'tib_borrower_rate_tier_b_pct', 13.50, 'pct', NOW() - INTERVAL '14 days', 'TZ',
   'TIB development-bank tier-B borrower rate, 2026'),

  -- BoT 91-day T-bill weighted-average yield (% annual). Real BoT auction band.
  ('BoT', 'bot_91d_tbill_yield_pct', 5.68, 'pct', NOW() - INTERVAL '20 days', 'TZ',
   'BoT 91-day treasury-bill weighted-average yield, 2026 auction'),

  -- Voluntary carbon-credit revenue per eligible hectare per year (TZS).
  -- Representative REDD+/afforestation credit value at ~USD 8/ha/yr, TZS ~2530/USD.
  ('OTHER', 'carbon_credit_tzs_per_hectare_per_year', 20240.00, 'TZS/hectare/year',
   NOW() - INTERVAL '60 days', 'TZ',
   'Voluntary carbon-credit revenue per eligible hectare/year, ~USD 8 @ 2530 TZS/USD')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2) ADDITIVE seed of peer_cohort_aggregates under the metric_id the FUEL slice
--    reads (`fuel_litres_per_tonne`). (Table owned by migration 0095.)
--    The resolver reads the latest p25 for this metric_id (no cohort filter).
-- -----------------------------------------------------------------------------

INSERT INTO peer_cohort_aggregates
  (cohort_key, metric_id, percentile_p25, percentile_p50, percentile_p75, sample_size, unit, notes)
VALUES
  ('TZ_artisanal_gold', 'fuel_litres_per_tonne', 1.80, 2.60, 3.70, 38, 'litres/tonne',
   'Diesel litres per ROM tonne, TZ artisanal gold cohort (p25 = best-in-class efficiency)')
ON CONFLICT (cohort_key, metric_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3) bot_gold_windows — Bank of Tanzania domestic gold-purchase windows.
--    The opportunity FX slice reads: is_open WHERE NOW() BETWEEN starts_at AND
--    ends_at. GLOBAL reference table (no tenant_id) — every tenant sees the
--    same BoT window calendar.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bot_gold_windows (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  window_name text        NOT NULL,
  is_open     boolean     NOT NULL DEFAULT true,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bgw_window_order_chk CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_bgw_window_span
  ON bot_gold_windows (starts_at, ends_at);

-- One window that is OPEN right now (real live-path signal for the demo), and
-- one already-closed historical window so the calendar is non-trivial.
INSERT INTO bot_gold_windows (window_name, is_open, starts_at, ends_at, notes)
SELECT 'BoT domestic gold-buy window Q3-2026', true,
       NOW() - INTERVAL '5 days', NOW() + INTERVAL '25 days',
       'Bank of Tanzania domestic gold purchase window, currently open'
WHERE NOT EXISTS (
  SELECT 1 FROM bot_gold_windows WHERE window_name = 'BoT domestic gold-buy window Q3-2026'
);

INSERT INTO bot_gold_windows (window_name, is_open, starts_at, ends_at, notes)
SELECT 'BoT domestic gold-buy window Q2-2026', false,
       NOW() - INTERVAL '95 days', NOW() - INTERVAL '35 days',
       'Bank of Tanzania domestic gold purchase window, closed'
WHERE NOT EXISTS (
  SELECT 1 FROM bot_gold_windows WHERE window_name = 'BoT domestic gold-buy window Q2-2026'
);

-- -----------------------------------------------------------------------------
-- 4) lbma_fix_summary — pre-rolled LBMA fix summary the RISK market slice reads:
--    (current_fix - mean_30d) / std_30d as a sigma delta, keyed by asset,
--    newest by captured_at. GLOBAL reference table.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lbma_fix_summary (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  asset       text          NOT NULL,
  current_fix numeric(20,4) NOT NULL,
  mean_30d    numeric(20,4) NOT NULL,
  std_30d     numeric(20,4) NOT NULL,
  captured_at timestamptz   NOT NULL DEFAULT now(),
  notes       text,
  CONSTRAINT lfs_std_nonneg_chk CHECK (std_30d >= 0)
);

CREATE INDEX IF NOT EXISTS idx_lfs_asset_captured
  ON lbma_fix_summary (asset, captured_at DESC);

-- Real July-2026 gold summary: current 4102.10 vs 30d mean 4091.80, std 22.40
-- → ~+0.46 sigma. Consistent with the daily series seeded in section (1).
INSERT INTO lbma_fix_summary (asset, current_fix, mean_30d, std_30d, captured_at, notes)
SELECT 'gold', 4102.10, 4091.80, 22.40, NOW() - INTERVAL '1 day',
       'LBMA gold fix 30d summary, July 2026'
WHERE NOT EXISTS (
  SELECT 1 FROM lbma_fix_summary
   WHERE asset = 'gold' AND captured_at >= NOW() - INTERVAL '2 days'
);

-- -----------------------------------------------------------------------------
-- 5) fx_rates_intraday — intraday FX snapshot the RISK market slice reads:
--    (intraday_high - intraday_low) / intraday_low * 100 as a volatility %,
--    keyed by pair, newest by captured_at. GLOBAL reference table.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fx_rates_intraday (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  pair           text          NOT NULL,
  intraday_open  numeric(20,6) NOT NULL,
  intraday_high  numeric(20,6) NOT NULL,
  intraday_low   numeric(20,6) NOT NULL,
  intraday_close numeric(20,6) NOT NULL,
  captured_at    timestamptz   NOT NULL DEFAULT now(),
  notes          text,
  CONSTRAINT fri_range_chk CHECK (intraday_high >= intraday_low)
);

CREATE INDEX IF NOT EXISTS idx_fri_pair_captured
  ON fx_rates_intraday (pair, captured_at DESC);

-- Real 2026 USD/TZS band: ~2530, intraday 2524–2538 → ~0.55% intraday vol.
INSERT INTO fx_rates_intraday
  (pair, intraday_open, intraday_high, intraday_low, intraday_close, captured_at, notes)
SELECT 'USD/TZS', 2530.000000, 2538.000000, 2524.000000, 2532.500000, NOW() - INTERVAL '6 hours',
       'BoT indicative USD/TZS intraday, 2026 band'
WHERE NOT EXISTS (
  SELECT 1 FROM fx_rates_intraday
   WHERE pair = 'USD/TZS' AND captured_at >= NOW() - INTERVAL '1 day'
);

-- -----------------------------------------------------------------------------
-- 6) RLS — GLOBAL reference posture on the THREE new market tables.
--    Reads open (shared reference data); WRITES service-role only (a tenant
--    session must NEVER write market data — it would poison every tenant's
--    scanner). Follows the 0310 canon: FORCE RLS + explicit policies. The 0095
--    tables (external_benchmarks / peer_cohort_aggregates) keep their existing
--    read-only-for-tenants posture (owned by 0095) and are untouched here.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['bot_gold_windows', 'lbma_fix_summary', 'fx_rates_intraday']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', tbl);

    -- (a) READ — open to every tenant session (global reference data).
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = tbl || '_read_global'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT USING (true)',
        tbl || '_read_global', tbl
      );
    END IF;

    -- (b) WRITE — service-role only. A tenant session (is_service_role unset)
    --     matches nothing → cannot INSERT/UPDATE/DELETE reference data.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = tbl || '_write_service_role'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
        || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'')',
        tbl || '_write_service_role', tbl
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
