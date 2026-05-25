-- ============================================================================
-- BORJIE — Marketplace (Listings + Tenders + Bids)
--
-- Listings are the front-door: they feed the customer-app marketplace and
-- create negotiations via enquiry-service. Tenders invite vendors to bid on
-- maintenance work; bids may be AI-negotiated via the TENDER_NEGOTIATOR
-- persona. Award always requires explicit human approval.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE marketplace_listing_kind AS ENUM ('rent', 'lease', 'sale');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE marketplace_listing_status AS ENUM (
    'draft', 'published', 'paused', 'closed'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE tender_status AS ENUM (
    'open', 'closed', 'awarded', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE tender_visibility AS ENUM ('public', 'invite_only');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE bid_status AS ENUM (
    'submitted', 'negotiating', 'awarded', 'rejected', 'withdrawn'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Marketplace Listings -----------------------------------------------------

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id                  TEXT NOT NULL REFERENCES units(id),
  property_id              TEXT REFERENCES properties(id),
  listing_kind             marketplace_listing_kind NOT NULL DEFAULT 'rent',
  headline_price           INTEGER NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'KES',
  negotiable               BOOLEAN NOT NULL DEFAULT true,
  media                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  attributes               JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                   marketplace_listing_status NOT NULL DEFAULT 'draft',
  published_at             TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  negotiation_policy_id    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               TEXT
);
CREATE INDEX IF NOT EXISTS marketplace_listings_tenant_idx ON marketplace_listings(tenant_id);
CREATE INDEX IF NOT EXISTS marketplace_listings_unit_idx ON marketplace_listings(unit_id);
CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx ON marketplace_listings(tenant_id, status);
CREATE INDEX IF NOT EXISTS marketplace_listings_published_idx ON marketplace_listings(published_at);

-- Tenders ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenders (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  work_order_id             TEXT,
  scope                     TEXT NOT NULL,
  details                   TEXT,
  budget_range_min          INTEGER NOT NULL,
  budget_range_max          INTEGER NOT NULL,
  currency                  TEXT NOT NULL DEFAULT 'KES',
  status                    tender_status NOT NULL DEFAULT 'open',
  visibility                tender_visibility NOT NULL DEFAULT 'public',
  invited_vendor_ids        JSONB DEFAULT '[]'::jsonb,
  ai_negotiator_enabled     BOOLEAN NOT NULL DEFAULT true,
  negotiation_policy_id     TEXT,
  closes_at                 TIMESTAMPTZ NOT NULL,
  awarded_at                TIMESTAMPTZ,
  awarded_bid_id            TEXT,
  cancelled_at              TIMESTAMPTZ,
  cancellation_reason       TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by                TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by                TEXT,
  CHECK (budget_range_min <= budget_range_max)
);
CREATE INDEX IF NOT EXISTS tenders_tenant_idx ON tenders(tenant_id);
CREATE INDEX IF NOT EXISTS tenders_status_idx ON tenders(tenant_id, status);
CREATE INDEX IF NOT EXISTS tenders_work_order_idx ON tenders(work_order_id);
CREATE INDEX IF NOT EXISTS tenders_closes_at_idx ON tenders(closes_at);

-- Bids ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bids (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tender_id                TEXT NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  vendor_id                TEXT NOT NULL,
  price                    INTEGER NOT NULL,
  currency                 TEXT NOT NULL DEFAULT 'KES',
  timeline_days            INTEGER NOT NULL,
  notes                    TEXT,
  attachments              JSONB DEFAULT '[]'::jsonb,
  status                   bid_status NOT NULL DEFAULT 'submitted',
  negotiation_id           TEXT,
  negotiation_turns        JSONB DEFAULT '[]'::jsonb,
  submitted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  awarded_at               TIMESTAMPTZ,
  rejected_at              TIMESTAMPTZ,
  rejection_reason         TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bids_tenant_idx ON bids(tenant_id);
CREATE INDEX IF NOT EXISTS bids_tender_idx ON bids(tender_id);
CREATE INDEX IF NOT EXISTS bids_vendor_idx ON bids(vendor_id);
CREATE INDEX IF NOT EXISTS bids_status_idx ON bids(tender_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS bids_tender_vendor_unique_idx
  ON bids(tender_id, vendor_id);
