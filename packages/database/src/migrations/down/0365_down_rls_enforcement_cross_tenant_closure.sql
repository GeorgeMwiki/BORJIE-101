-- =============================================================================
-- Down-migration 0365 — drop the RLS-enforcement cross-tenant closure policies.
--
-- Dev/staging only. Reverses 0365 by dropping the five additive policies,
-- reverting each table to tenant-isolation-only RLS:
--   * rfb_open_public_read                          ON request_for_bids
--   * rfb_responses_seller_insert / _seller_read    ON request_for_bid_responses
--   * owner_tabs_structural_service_role_bypass      ON owner_tabs_structural
--   * saved_searches_service_role_bypass             ON saved_searches
--   * marketplace_listings_service_role_bypass       ON marketplace_listings
--
-- WARNING: once FORCE RLS is enforced, dropping these RE-DARKENS the intentional
-- cross-tenant feeds — the RFB /nearby seller-discovery feed and seller
-- write-back, the buyer cross-tenant tab projection, the saved-search alert
-- worker drain, and the HQ marketplace moderation queue all go silently to zero
-- rows. Pure RLS metadata — no data touched, table-guarded + idempotent. Do not
-- run against production.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.request_for_bids') IS NOT NULL THEN
    DROP POLICY IF EXISTS rfb_open_public_read ON request_for_bids;
  END IF;

  IF to_regclass('public.request_for_bid_responses') IS NOT NULL THEN
    DROP POLICY IF EXISTS rfb_responses_seller_insert ON request_for_bid_responses;
    DROP POLICY IF EXISTS rfb_responses_seller_read   ON request_for_bid_responses;
  END IF;

  IF to_regclass('public.owner_tabs_structural') IS NOT NULL THEN
    DROP POLICY IF EXISTS owner_tabs_structural_service_role_bypass ON owner_tabs_structural;
  END IF;

  IF to_regclass('public.saved_searches') IS NOT NULL THEN
    DROP POLICY IF EXISTS saved_searches_service_role_bypass ON saved_searches;
  END IF;

  IF to_regclass('public.marketplace_listings') IS NOT NULL THEN
    DROP POLICY IF EXISTS marketplace_listings_service_role_bypass ON marketplace_listings;
  END IF;
END $$;

COMMIT;
