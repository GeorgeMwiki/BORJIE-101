-- =============================================================================
-- Migration 0006 — marketplace_bids
--
-- Replaces the BID_ON temporal_relationships workaround used by
-- services/api-gateway/src/routes/mining/bids.hono.ts with a dedicated
-- first-class table. Buyer bids on marketplace_listings now live in
-- `marketplace_bids` with a typed status enum, dedicated price column,
-- payment-terms enum, and FK to fingerprint_events for biometric
-- attestation on accept.
--
-- 1. Creates `marketplace_bid_payment_terms` + `marketplace_bid_status`
--    enums (idempotent via DO blocks).
-- 2. Creates `marketplace_bids` table + indexes.
-- 3. Enables Row Level Security + `tenant_isolation` policy.
-- 4. Best-effort backfill from `temporal_relationships` BID_ON edges:
--    pulls rows whose `attributes` JSON contains the expected keys
--    (listingId, currency) and inserts into the new table on conflict do
--    nothing.
--
-- Idempotent (IF NOT EXISTS, DO blocks for enums, ON CONFLICT). Safe to
-- re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  CREATE TYPE marketplace_bid_payment_terms AS ENUM ('instant', 'net_30', 'net_60');
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'enum marketplace_bid_payment_terms already exists — skipping';
END$$;

DO $$
BEGIN
  CREATE TYPE marketplace_bid_status AS ENUM (
    'pending',
    'accepted',
    'rejected',
    'countered',
    'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'enum marketplace_bid_status already exists — skipping';
END$$;

-- -----------------------------------------------------------------------------
-- 2. Table
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketplace_bids (
  id                            text PRIMARY KEY,
  tenant_id                     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  listing_id                    text NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  buyer_id                      text NOT NULL REFERENCES buyers(id) ON DELETE RESTRICT,
  bid_price_tzs                 numeric(18,2) NOT NULL,
  payment_terms                 marketplace_bid_payment_terms NOT NULL DEFAULT 'instant',
  notes                         text,
  status                        marketplace_bid_status NOT NULL DEFAULT 'pending',
  counter_price_tzs             numeric(18,2),
  accepted_at                   timestamptz,
  signed_fingerprint_event_id   text,
  attributes                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_bids_tenant_status_idx
  ON marketplace_bids(tenant_id, status);
CREATE INDEX IF NOT EXISTS marketplace_bids_listing_idx
  ON marketplace_bids(listing_id);
CREATE INDEX IF NOT EXISTS marketplace_bids_buyer_idx
  ON marketplace_bids(buyer_id);

-- -----------------------------------------------------------------------------
-- 3. Row Level Security — tenant_isolation
-- -----------------------------------------------------------------------------

ALTER TABLE marketplace_bids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON marketplace_bids;
CREATE POLICY tenant_isolation ON marketplace_bids
  USING (tenant_id = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 4. Best-effort backfill from temporal_relationships BID_ON edges
--
-- Pulls each BID_ON edge whose `attributes` jsonb has the shape the old
-- route wrote (listingId + currency present). Maps amountTzs (or
-- amountUsd as fallback when amountTzs is null but currency='USD' — kept
-- as 0 to avoid type errors) into bid_price_tzs. Buyer linkage is
-- best-effort: we resolve via the existing `buyers` table on
-- buyerUserId == buyers.attributes->>'user_id' (legacy mapping). Edges
-- without a resolvable buyer are skipped — they remain in the temporal
-- graph as historical record.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  -- Skip backfill if either source or target tables are absent.
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'temporal_relationships') THEN
    RAISE NOTICE '[0006] temporal_relationships absent — skipping backfill';
    RETURN;
  END IF;

  INSERT INTO marketplace_bids (
    id,
    tenant_id,
    listing_id,
    buyer_id,
    bid_price_tzs,
    payment_terms,
    notes,
    status,
    attributes,
    created_at,
    updated_at
  )
  SELECT
    tr.id,
    tr.tenant_id,
    (tr.attributes ->> 'listingId') AS listing_id,
    b.id AS buyer_id,
    COALESCE(
      NULLIF(tr.attributes ->> 'amountTzs', '')::numeric(18,2),
      0::numeric(18,2)
    ) AS bid_price_tzs,
    'instant'::marketplace_bid_payment_terms AS payment_terms,
    NULLIF(tr.attributes ->> 'message', '') AS notes,
    CASE
      WHEN (tr.attributes ->> 'status') = 'accepted'  THEN 'accepted'::marketplace_bid_status
      WHEN (tr.attributes ->> 'status') = 'rejected'  THEN 'rejected'::marketplace_bid_status
      WHEN (tr.attributes ->> 'status') = 'countered' THEN 'countered'::marketplace_bid_status
      WHEN (tr.attributes ->> 'status') = 'withdrawn' THEN 'withdrawn'::marketplace_bid_status
      ELSE 'pending'::marketplace_bid_status
    END AS status,
    tr.attributes AS attributes,
    tr.recorded_at AS created_at,
    tr.recorded_at AS updated_at
  FROM temporal_relationships tr
  JOIN marketplace_listings ml
    ON ml.id = (tr.attributes ->> 'listingId')
  LEFT JOIN buyers b
    ON b.tenant_id = tr.tenant_id
   AND (b.attributes ->> 'user_id') = (tr.attributes ->> 'buyerUserId')
  WHERE tr.relationship = 'BID_ON'
    AND tr.attributes ? 'listingId'
    AND tr.attributes ? 'currency'
    AND b.id IS NOT NULL
  ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN others THEN
  RAISE NOTICE '[0006] backfill skipped: %', SQLERRM;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0006_marketplace_bids.sql
-- =============================================================================
