-- =============================================================================
-- Migration 0005 — Borjie mining-domain extensions
--
-- Adds four mining-specific concerns:
--
--   1. buyers: financial-profile columns (credit_limit_tzs, aml_status,
--      banking_jsonb, payment_history_jsonb).
--   2. buyer_risk_reports: composite per-buyer risk score.
--   3. bid_negotiations: append-only thread of offers/counters on bids.
--   4. ore_grade_snapshots: immutable per-parcel grading snapshots.
--   5. ore_stockpiles: physical custody of ore parcels.
--
-- All tables are tenant-scoped with RLS enabled.
-- Idempotent (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Extend `buyers` with financial-profile columns
-- -----------------------------------------------------------------------------

ALTER TABLE IF EXISTS buyers
  ADD COLUMN IF NOT EXISTS credit_limit_tzs       numeric(18,2),
  ADD COLUMN IF NOT EXISTS aml_status             text NOT NULL DEFAULT 'clear',
  ADD COLUMN IF NOT EXISTS banking_jsonb          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_history_jsonb  jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS buyers_aml_status_idx
  ON buyers(tenant_id, aml_status);

-- -----------------------------------------------------------------------------
-- 2. buyer_risk_reports
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS buyer_risk_reports (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  buyer_id            text NOT NULL REFERENCES buyers(id)  ON DELETE CASCADE,
  score_0_100         smallint NOT NULL DEFAULT 0,
  risk_level          text NOT NULL DEFAULT 'low',
  dimensions          jsonb NOT NULL DEFAULT '{}'::jsonb,
  narrative           text,
  recommendations     jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,
  generated_by_model  text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buyer_risk_reports_tenant_idx
  ON buyer_risk_reports(tenant_id);
CREATE INDEX IF NOT EXISTS buyer_risk_reports_buyer_idx
  ON buyer_risk_reports(buyer_id);
CREATE INDEX IF NOT EXISTS buyer_risk_reports_generated_at_idx
  ON buyer_risk_reports(tenant_id, buyer_id, generated_at);
CREATE INDEX IF NOT EXISTS buyer_risk_reports_level_idx
  ON buyer_risk_reports(tenant_id, risk_level);

-- -----------------------------------------------------------------------------
-- 3. bid_negotiations — append-only
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bid_negotiations (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bid_id                      text NOT NULL REFERENCES marketplace_bids(id) ON DELETE CASCADE,
  from_user_id                text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action                      text NOT NULL,
  price_tzs                   numeric(18,2),
  terms_jsonb                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale                   text,
  signed_fingerprint_event_id text REFERENCES fingerprint_events(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_negotiations_action_check
    CHECK (action IN ('offer','counter','accept','reject','withdraw'))
);

CREATE INDEX IF NOT EXISTS bid_negotiations_tenant_idx
  ON bid_negotiations(tenant_id);
CREATE INDEX IF NOT EXISTS bid_negotiations_bid_idx
  ON bid_negotiations(bid_id, created_at);
CREATE INDEX IF NOT EXISTS bid_negotiations_actor_idx
  ON bid_negotiations(from_user_id);
CREATE INDEX IF NOT EXISTS bid_negotiations_action_idx
  ON bid_negotiations(tenant_id, action);

-- -----------------------------------------------------------------------------
-- 4. ore_grade_snapshots
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ore_grade_snapshots (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parcel_id           text NOT NULL REFERENCES ore_parcels(id) ON DELETE CASCADE,
  grade_pct           numeric(6,3) NOT NULL,
  processability      numeric(4,3) NOT NULL,
  blendability        numeric(4,3) NOT NULL,
  target_customer_fit text,
  assay_evidence_ids  text[] NOT NULL DEFAULT ARRAY[]::text[],
  dimensions          jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_at         timestamptz NOT NULL DEFAULT now(),
  snapshot_by_model   text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ore_grade_snapshots_tenant_idx
  ON ore_grade_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS ore_grade_snapshots_parcel_idx
  ON ore_grade_snapshots(parcel_id);
CREATE INDEX IF NOT EXISTS ore_grade_snapshots_parcel_snapshot_idx
  ON ore_grade_snapshots(parcel_id, snapshot_at);
CREATE INDEX IF NOT EXISTS ore_grade_snapshots_target_fit_idx
  ON ore_grade_snapshots(tenant_id, target_customer_fit);

-- -----------------------------------------------------------------------------
-- 5. ore_stockpiles
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ore_stockpiles (
  id                       text PRIMARY KEY,
  tenant_id                text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parcel_id                text NOT NULL REFERENCES ore_parcels(id) ON DELETE CASCADE,
  site_id                  text REFERENCES sites(id) ON DELETE SET NULL,
  location_kind            text NOT NULL DEFAULT 'site',
  location_ref             text,
  quantity_kg              numeric(12,3) NOT NULL,
  custodian_user_id        text REFERENCES users(id) ON DELETE SET NULL,
  custody_event_log_jsonb  jsonb NOT NULL DEFAULT '[]'::jsonb,
  stored_at                timestamptz NOT NULL DEFAULT now(),
  last_inspected_at        timestamptz,
  attributes               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ore_stockpiles_location_kind_check
    CHECK (location_kind IN ('site','warehouse','in_transit'))
);

CREATE INDEX IF NOT EXISTS ore_stockpiles_tenant_idx
  ON ore_stockpiles(tenant_id);
CREATE INDEX IF NOT EXISTS ore_stockpiles_parcel_idx
  ON ore_stockpiles(parcel_id);
CREATE INDEX IF NOT EXISTS ore_stockpiles_site_idx
  ON ore_stockpiles(site_id);
CREATE INDEX IF NOT EXISTS ore_stockpiles_location_kind_idx
  ON ore_stockpiles(tenant_id, location_kind);
CREATE INDEX IF NOT EXISTS ore_stockpiles_custodian_idx
  ON ore_stockpiles(custodian_user_id);

-- -----------------------------------------------------------------------------
-- 6. RLS — tenant_isolation policy on every new table
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'buyer_risk_reports',
    'bid_negotiations',
    'ore_grade_snapshots',
    'ore_stockpiles'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I;', t
    );
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

COMMIT;
