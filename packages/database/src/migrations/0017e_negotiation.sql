-- ============================================================================
-- BORJIE — Negotiation (Price Negotiation Engine)
--
-- Policy-sandboxed AI price negotiation engine. The AI negotiator is bounded
-- by `floorPrice` (hard floor; violations rejected) and `approvalRequiredBelow`
-- (soft gate; auto-escalates to human advisor). Turns are append-only.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE negotiation_status AS ENUM (
    'open',
    'counter_sent',
    'accepted',
    'rejected',
    'expired',
    'escalated'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE negotiation_actor AS ENUM (
    'prospect',
    'ai',
    'owner',
    'agent',
    'vendor'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE negotiation_domain AS ENUM (
    'lease_price',
    'tender_bid'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE negotiation_tone AS ENUM (
    'firm',
    'warm',
    'flexible'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Policies -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS negotiation_policies (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id                  TEXT REFERENCES units(id) ON DELETE CASCADE,
  property_id              TEXT REFERENCES properties(id) ON DELETE CASCADE,
  domain                   negotiation_domain NOT NULL DEFAULT 'lease_price',
  list_price               INTEGER NOT NULL,
  floor_price              INTEGER NOT NULL,
  approval_required_below  INTEGER NOT NULL,
  max_discount_pct         DECIMAL(5,2) NOT NULL DEFAULT 0,
  currency                 TEXT NOT NULL DEFAULT 'KES',
  acceptable_concessions   JSONB DEFAULT '[]'::jsonb,
  tone_guide               negotiation_tone NOT NULL DEFAULT 'warm',
  auto_send_counters       BOOLEAN NOT NULL DEFAULT false,
  expires_at               TIMESTAMPTZ,
  active                   BOOLEAN NOT NULL DEFAULT true,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by               TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by               TEXT,
  CHECK (floor_price <= list_price),
  CHECK (approval_required_below >= floor_price),
  CHECK (unit_id IS NOT NULL OR property_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS negotiation_policies_tenant_idx ON negotiation_policies(tenant_id);
CREATE INDEX IF NOT EXISTS negotiation_policies_unit_idx ON negotiation_policies(unit_id);
CREATE INDEX IF NOT EXISTS negotiation_policies_property_idx ON negotiation_policies(property_id);
CREATE INDEX IF NOT EXISTS negotiation_policies_active_idx ON negotiation_policies(tenant_id, active);

-- Negotiations -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS negotiations (
  id                        TEXT PRIMARY KEY,
  tenant_id                 TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id                   TEXT REFERENCES units(id),
  property_id               TEXT REFERENCES properties(id),
  prospect_customer_id      TEXT REFERENCES customers(id),
  counterparty_id           TEXT,
  listing_id                TEXT,
  tender_id                 TEXT,
  bid_id                    TEXT,
  policy_id                 TEXT NOT NULL REFERENCES negotiation_policies(id),
  domain                    negotiation_domain NOT NULL DEFAULT 'lease_price',
  status                    negotiation_status NOT NULL DEFAULT 'open',
  ai_persona                TEXT NOT NULL DEFAULT 'PRICE_NEGOTIATOR',
  current_offer             INTEGER,
  current_offer_by          negotiation_actor,
  round_count               INTEGER NOT NULL DEFAULT 0,
  agreed_price              INTEGER,
  closed_at                 TIMESTAMPTZ,
  closure_reason            TEXT,
  escalated_at              TIMESTAMPTZ,
  escalated_to              TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS negotiations_tenant_idx ON negotiations(tenant_id);
CREATE INDEX IF NOT EXISTS negotiations_unit_idx ON negotiations(unit_id);
CREATE INDEX IF NOT EXISTS negotiations_status_idx ON negotiations(tenant_id, status);
CREATE INDEX IF NOT EXISTS negotiations_bid_idx ON negotiations(bid_id);
CREATE INDEX IF NOT EXISTS negotiations_tender_idx ON negotiations(tender_id);

-- Turns (APPEND-ONLY) ------------------------------------------------------

CREATE TABLE IF NOT EXISTS negotiation_turns (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  negotiation_id           TEXT NOT NULL REFERENCES negotiations(id) ON DELETE CASCADE,
  sequence                 INTEGER NOT NULL,
  actor                    negotiation_actor NOT NULL,
  actor_user_id            TEXT,
  offer                    INTEGER,
  concessions_proposed     JSONB DEFAULT '[]'::jsonb,
  rationale                TEXT,
  ai_model_tier            TEXT,
  policy_snapshot_id       TEXT,
  policy_check_passed      BOOLEAN NOT NULL DEFAULT true,
  policy_check_violations  JSONB DEFAULT '[]'::jsonb,
  advisor_consulted        BOOLEAN NOT NULL DEFAULT false,
  advisor_decision         TEXT,
  raw_payload              JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS negotiation_turns_negotiation_idx ON negotiation_turns(negotiation_id);
CREATE INDEX IF NOT EXISTS negotiation_turns_tenant_idx ON negotiation_turns(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS negotiation_turns_sequence_idx
  ON negotiation_turns(negotiation_id, sequence);
CREATE INDEX IF NOT EXISTS negotiation_turns_created_at_idx ON negotiation_turns(created_at);

-- Append-only guard: reject UPDATE/DELETE on turns
CREATE OR REPLACE FUNCTION negotiation_turns_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'negotiation_turns is append-only; % blocked', TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER negotiation_turns_no_update
    BEFORE UPDATE ON negotiation_turns
    FOR EACH ROW EXECUTE FUNCTION negotiation_turns_immutable();
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TRIGGER negotiation_turns_no_delete
    BEFORE DELETE ON negotiation_turns
    FOR EACH ROW EXECUTE FUNCTION negotiation_turns_immutable();
EXCEPTION WHEN duplicate_object THEN null; END $$;
