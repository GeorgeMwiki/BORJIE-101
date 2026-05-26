-- ============================================================================
-- Migration 0170 — carbon-market book of trades (paper forwards + spot).
--
-- Persistent backing for the `BookEntryRepository` port declared in
-- `packages/carbon-market/src/types.ts`. The in-memory implementation
-- (`createInMemoryBookRepository`) remains the default for dev / tests;
-- this table is opt-in at the api-gateway composition root via
-- `createPostgresBookRepository({ db })` from
-- `@borjie/carbon-market`.
--
-- Closes the deferred P6 production-readiness item (the trading desk
-- shipped against an in-memory book only). Every booked forward,
-- mark-to-market input, and settlement state transition now survives
-- a gateway restart.
--
-- Shape rationale:
--   - `entry_id` is a TEXT primary key — the desk generates short
--     `BE-<base36-ts>-<counter>` ids; uniqueness lives at the desk layer.
--   - `qty NUMERIC(20,6)` — carbon credits are denominated in tCO2e
--     (one unit = one tonne of CO2 equivalent). Six decimals accommodates
--     fractional Article 6 ITMO transfers without rounding.
--   - `price_per_unit_cents BIGINT` — USD price per tCO2e, stored in
--     cents to avoid binary-float drift in mark-to-market sums. The
--     desk's BookEntry exposes `priceUsdPerTonne` as a number; the
--     adapter multiplies by 100 on write, divides on read.
--   - `currency CHAR(3)` — ISO-4217 for cross-currency future-proofing
--     even though the desk currently normalises to USD before booking.
--   - `tenor` — nullable, NULL for spot trades. The desk currently
--     always passes a tenor string ('Dec-26', 'M+6'); future spot
--     extensions can store NULL.
--   - `status` — three-state enum ('open' | 'settled' | 'cancelled').
--     Stored as TEXT (Drizzle-friendly) with a check constraint pinning
--     the values.
--   - `metadata JSONB` — open extension point for cancellation reasons,
--     compliance flags, custodian references, etc. Defaults to {}.
--
-- Multi-tenant isolation:
--   - tenant_id mandatory ⇒ pairs cleanly with RLS migration 0155.
--   - Two indexes — `(tenant_id, status)` for the "show me open trades"
--     dashboard, `(tenant_id, symbol, trade_date desc)` for the per-
--     symbol mark-to-market scan path.
--
-- Backwards-compatible: CREATE TABLE / INDEX IF NOT EXISTS only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS carbon_market_book_entries (
  entry_id              TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  counterparty          TEXT NOT NULL,
  symbol                TEXT NOT NULL,
  side                  TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  qty                   NUMERIC(20, 6) NOT NULL,
  price_per_unit_cents  BIGINT NOT NULL,
  currency              CHAR(3) NOT NULL,
  tenor                 TEXT,
  trade_date            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settlement_date       TIMESTAMPTZ,
  status                TEXT NOT NULL CHECK (status IN ('open', 'settled', 'cancelled')),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carbon_market_book_entries_tenant_status_idx
  ON carbon_market_book_entries (tenant_id, status);

CREATE INDEX IF NOT EXISTS carbon_market_book_entries_tenant_symbol_idx
  ON carbon_market_book_entries (tenant_id, symbol, trade_date DESC);

COMMENT ON TABLE carbon_market_book_entries IS
  'Carbon-market trading-desk paper forwards + spot book. Persistent BookEntryRepository.';
COMMENT ON COLUMN carbon_market_book_entries.qty IS
  'tCO2e (tonnes of CO2 equivalent). NUMERIC(20,6) supports fractional ITMO transfers.';
COMMENT ON COLUMN carbon_market_book_entries.price_per_unit_cents IS
  'USD price per tCO2e in cents (BIGINT). Avoids binary-float drift in mark-to-market sums.';
