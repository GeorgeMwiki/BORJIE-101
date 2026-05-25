-- =============================================================================
-- 0034: tenants.country_code — align tenant country with compliance-plugins
-- =============================================================================
-- The `tenants` table already carries a `country` column (text, default 'KE')
-- from migration 0001. The compliance-plugin registry in
-- `@borjie/compliance-plugins` keys every plugin by ISO-3166-1 alpha-2.
--
-- This migration does two additive things:
--   1. Clears the 'KE' default so existing tenants without a country fall
--      through to the middleware's DEFAULT_COUNTRY_ID (currently 'TZ') with
--      an explicit operator warning, rather than silently being assumed
--      Kenyan.
--   2. Adds an index on `country` so the gateway's per-tenant plugin
--      resolution stays fast at high request volume.
--
-- The column itself is NOT renamed — many existing services query `country`
-- directly. It remains nullable during rollout; a future migration will
-- backfill every tenant and add NOT NULL once every record is populated.
-- =============================================================================

-- Drop the legacy 'KE' default. New tenant rows must explicitly select a
-- country via onboarding; if they don't, the middleware falls back to
-- DEFAULT_COUNTRY_ID with a logged warning.
ALTER TABLE tenants
  ALTER COLUMN country DROP DEFAULT;

-- Case-insensitive lookups are handled in middleware (upper-case normalization
-- happens before the SQL round-trip). A plain btree on `country` is enough.
CREATE INDEX IF NOT EXISTS tenants_country_idx
  ON tenants (country);
