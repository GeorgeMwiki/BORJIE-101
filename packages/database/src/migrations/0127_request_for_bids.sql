-- =============================================================================
-- Migration 0127 — Buyer-initiated Request for Bids (R11)
--
-- Buyers post "I want N tonnes of mineral X at TZS Y per unit by date D".
-- Sellers within the radius see the row in their nearby feed, then post
-- counter-offers via the marketplace responses sidecar.
--
-- Tenant scope:
--   RLS FORCE per CLAUDE.md hard rule. The buyer's tenant_id is
--   stamped at insert by the route handler reading auth.tenantId.
--   The nearby-feed seller endpoint joins ON the seller's
--   estate location vs the RFB's lat/lon + radius_km, so
--   cross-tenant visibility is the deliberate design and is
--   gated only by the geo predicate — RLS uses the same tenant
--   scoping every other tenant-scoped table does.
--
-- Status lifecycle:
--   open       buyer just posted; visible to sellers in radius
--   filled     buyer accepted a seller response, RFB closed
--   expired    expires_at passed without resolution
--   cancelled  buyer pulled the request before any acceptance
--
-- Provenance is stamped jsonb so the brain can trace whether the
-- RFB came from chat (via=chat + sessionId/turnId), the buyer
-- mobile form (via=buyer_mobile), or a manual operator action.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS request_for_bids (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  buyer_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mineral_kind     TEXT NOT NULL,
  grade_min        TEXT,
  tonnage_min      NUMERIC(10,3) NOT NULL,
  tonnage_max      NUMERIC(10,3),
  unit_price_tzs   NUMERIC(15,2) NOT NULL,
  delivery_by      DATE NOT NULL,
  location_lat     NUMERIC(9,6),
  location_lon     NUMERIC(9,6),
  radius_km        INTEGER NOT NULL DEFAULT 200,
  status           TEXT NOT NULL DEFAULT 'open',
  notes            TEXT,
  provenance       JSONB NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '14 days',

  CONSTRAINT request_for_bids_status_check CHECK (
    status IN ('open', 'filled', 'expired', 'cancelled')
  ),
  CONSTRAINT request_for_bids_tonnage_min_positive CHECK (tonnage_min > 0),
  CONSTRAINT request_for_bids_tonnage_max_check CHECK (
    tonnage_max IS NULL OR tonnage_max >= tonnage_min
  ),
  CONSTRAINT request_for_bids_unit_price_positive CHECK (unit_price_tzs > 0),
  CONSTRAINT request_for_bids_radius_range CHECK (
    radius_km > 0 AND radius_km <= 5000
  )
);

-- Tenant-scoped lookups for buyer's own RFBs.
CREATE INDEX IF NOT EXISTS request_for_bids_tenant_status_mineral_idx
  ON request_for_bids (tenant_id, status, mineral_kind);

-- Geo predicate for the seller nearby feed. Partial index keeps the
-- working set tight — once an RFB is filled / expired / cancelled
-- the planner ignores it.
CREATE INDEX IF NOT EXISTS request_for_bids_open_geo_idx
  ON request_for_bids (location_lat, location_lon)
  WHERE status = 'open';

-- Provenance jsonb path index (gin) so the brain audit trail can
-- query RFBs by their via=… origin.
CREATE INDEX IF NOT EXISTS request_for_bids_provenance_gin_idx
  ON request_for_bids USING gin (provenance);

-- Time-to-live sweep query (expire RFBs whose expires_at has passed).
CREATE INDEX IF NOT EXISTS request_for_bids_expires_at_idx
  ON request_for_bids (expires_at)
  WHERE status = 'open';

-- =============================================================================
-- Seller responses sidecar — one-to-many. We keep responses in a
-- separate table so the buyer's RFB row stays compact and the
-- nearby-feed query never has to aggregate responses.
-- =============================================================================

CREATE TABLE IF NOT EXISTS request_for_bid_responses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfb_id           UUID NOT NULL REFERENCES request_for_bids(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL,
  seller_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offered_tonnage  NUMERIC(10,3) NOT NULL,
  offered_price_tzs NUMERIC(15,2) NOT NULL,
  delivery_by      DATE NOT NULL,
  notes            TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  provenance       JSONB NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT rfb_responses_status_check CHECK (
    status IN ('pending', 'accepted', 'rejected', 'withdrawn')
  ),
  CONSTRAINT rfb_responses_tonnage_positive CHECK (offered_tonnage > 0),
  CONSTRAINT rfb_responses_price_positive CHECK (offered_price_tzs > 0)
);

CREATE INDEX IF NOT EXISTS rfb_responses_rfb_status_idx
  ON request_for_bid_responses (rfb_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS rfb_responses_tenant_seller_idx
  ON request_for_bid_responses (tenant_id, seller_id, created_at DESC);

-- =============================================================================
-- Row-level security: per-tenant isolation FORCE-enabled on both tables.
-- =============================================================================

ALTER TABLE request_for_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_for_bids FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rfb_tenant_isolation ON request_for_bids;

CREATE POLICY rfb_tenant_isolation ON request_for_bids
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

ALTER TABLE request_for_bid_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_for_bid_responses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rfb_responses_tenant_isolation ON request_for_bid_responses;

CREATE POLICY rfb_responses_tenant_isolation ON request_for_bid_responses
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

COMMENT ON TABLE request_for_bids IS
  'R11 buyer-initiated marketplace RFB. Buyer posts requirement '
  '(mineral, tonnage, price, delivery, radius); sellers within the '
  'geo predicate respond via request_for_bid_responses.';

COMMENT ON TABLE request_for_bid_responses IS
  'R11 seller responses to buyer-initiated RFBs. Each row is one '
  'counter-offer; the buyer accepts ONE which flips the parent RFB '
  'to status=filled.';

COMMIT;
