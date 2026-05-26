-- ─────────────────────────────────────────────────────────────────────
-- Migration 0120 — Market data cache.
--
-- Caches results from external market-data adapters (Zillow, Airbnb,
-- Rentometer, regional comparable-rent feeds, etc.) so that repeated
-- kernel queries within a TTL do not hammer the upstream provider.
--
-- Not tenant-scoped — platform-tier external data is reusable across
-- every tenant asking the same question. Tenant-isolation does not
-- apply: the cached payloads carry no tenant PII (rents are per-
-- jurisdiction; addresses are fingerprinted before they enter the row).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Re-running the migration on an existing schema is safe.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS market_data_cache (
  cache_key   TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  query_json  JSONB NOT NULL,
  result_json JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_data_cache_provider
  ON market_data_cache (provider);

CREATE INDEX IF NOT EXISTS idx_market_data_cache_expires
  ON market_data_cache (expires_at);

COMMENT ON TABLE market_data_cache IS
  'Per-(provider, query) TTL cache for external market-data adapter responses (Zillow, Airbnb, etc.). Not tenant-scoped. cache_key is sha256(provider | normalised query).';
