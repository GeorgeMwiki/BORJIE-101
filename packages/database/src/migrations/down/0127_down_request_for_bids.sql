-- Reverse migration 0127 — drop the buyer-initiated RFB tables.
-- Used by the migration test harness only; production rollbacks should
-- prefer forward migrations.

BEGIN;

DROP TABLE IF EXISTS request_for_bid_responses;
DROP TABLE IF EXISTS request_for_bids;

COMMIT;
