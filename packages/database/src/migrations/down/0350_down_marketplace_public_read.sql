-- =============================================================================
-- Down-migration 0350 — drop the cross-tenant marketplace public-read policy.
--
-- Reverts to strict per-tenant isolation on marketplace_listings (the FOR ALL
-- tenant_isolation policy from 0297 remains). Reverses
-- 0350_marketplace_public_read.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS marketplace_listings_public_read ON marketplace_listings;

COMMIT;
