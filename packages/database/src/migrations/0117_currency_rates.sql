-- ─────────────────────────────────────────────────────────────────────
-- Migration 0117 — Currency rates.
--
-- FX-rate snapshot table backing the platform-overview HQ KPI router's
-- monthly-revenue aggregator. Each row maps an ISO-4217 currency code
-- to its current rate against USD ("1 unit of <code> = rate_to_usd
-- USD"). The platform aggregator sums payments per currency, then
-- normalises each slice to USD via this table before reporting a
-- single cross-tenant figure.
--
-- Seeded with manual defaults for USD / TZS / KES (the three
-- currencies Borjie tenants currently transact in). Future work:
-- a daily refresh job that pulls from a real feed (fixer.io / ECB)
-- and stamps source + as_of accordingly.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS currency_rates (
  code         TEXT PRIMARY KEY,
  rate_to_usd  DOUBLE PRECISION NOT NULL,
  as_of        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source       TEXT
);

CREATE INDEX IF NOT EXISTS idx_currency_rates_as_of
  ON currency_rates (as_of);

-- Seed default rates so the aggregator has something to normalise
-- against on first boot. ON CONFLICT DO NOTHING preserves any
-- subsequent operator-supplied refresh.
INSERT INTO currency_rates (code, rate_to_usd, source) VALUES
  ('USD', 1.0,        'seed-default'),
  ('TZS', 0.000395,   'seed-default-2026'),  -- 1 TZS ≈ 0.000395 USD as of 2026-Q2
  ('KES', 0.0077,     'seed-default-2026')   -- 1 KES ≈ 0.0077 USD as of 2026-Q2
ON CONFLICT (code) DO NOTHING;

COMMENT ON TABLE currency_rates IS
  'ISO-4217 → USD FX snapshots. Seeded with USD/TZS/KES defaults; future jobs may refresh from fixer.io / ECB. Consumed by the platform-overview monthly-revenue aggregator.';
