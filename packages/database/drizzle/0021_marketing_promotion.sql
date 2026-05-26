-- =============================================================================
-- Migration 0021 — Marketing & Promotion schema (Wave 18P)
--
-- Companion to docs/DESIGN/MARKETING_PROMOTION_SPEC.md. Adds the
-- persistence substrate for Mr. Mwikila's campaign-driven marketing
-- studio across 12 channels:
--
--   1. campaign_recipes          — versioned recipe registry (global,
--                                    like document_recipes). Closed set
--                                    of recipe ids; status lifecycle
--                                    draft|shadow|live|locked|deprecated.
--   2. campaign_runs             — one row per launched campaign.
--                                    Tenant-scoped.
--   3. campaign_assets           — one row per published asset within
--                                    a run (typically multi-channel +
--                                    multi-variant). Tenant-scoped via
--                                    run parent.
--   4. marketing_telemetry_events— impression/click/conversion events
--                                    feeding the lock/improve loop.
--                                    Tenant-scoped via run grandparent.
--   5. marketing_ab_results      — per-variant Bayesian results.
--                                    Tenant-scoped via run parent.
--   6. marketing_compliance_scans— per-asset claim/forbidden/disclaimer/
--                                    geo scans. Tenant-scoped via asset.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern (migration 0003).
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. campaign_recipes — versioned recipe registry (global)
-- -----------------------------------------------------------------------------
-- Recipes are product-wide config; tenants share the registry. Live
-- recipes never mutate in place — improvement proposals create
-- version n+1 in shadow state, promoted to live only after owner
-- approval. Locked recipes refuse all auto-improvement signals.

CREATE TABLE IF NOT EXISTS campaign_recipes (
  id                  text NOT NULL,
  version             integer NOT NULL,
  status              text NOT NULL,
  authority_tier      smallint NOT NULL,
  audience_segments   text[] NOT NULL DEFAULT ARRAY[]::text[],
  compose_fn_ref      text NOT NULL,
  sequencing          text NOT NULL,
  compliance          jsonb NOT NULL DEFAULT '{}'::jsonb,
  success_metrics     jsonb NOT NULL DEFAULT '[]'::jsonb,
  brand               text NOT NULL DEFAULT 'borjie',
  promoted_at         timestamptz,
  promoted_by         text REFERENCES users(id) ON DELETE SET NULL,
  locked_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version),
  CONSTRAINT campaign_recipes_brand_chk CHECK (brand = 'borjie'),
  CONSTRAINT campaign_recipes_authority_chk CHECK (authority_tier IN (0,1,2)),
  CONSTRAINT campaign_recipes_status_chk
    CHECK (status IN ('draft','shadow','live','locked','deprecated')),
  CONSTRAINT campaign_recipes_sequencing_chk
    CHECK (sequencing IN ('parallel','cascading','staggered'))
);

CREATE INDEX IF NOT EXISTS campaign_recipes_status_idx ON campaign_recipes(status);
CREATE INDEX IF NOT EXISTS campaign_recipes_live_idx
  ON campaign_recipes(id, version) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS campaign_recipes_promoted_by_idx
  ON campaign_recipes(promoted_by);

-- campaign_recipes is global product config — RLS off, service-account write.
ALTER TABLE campaign_recipes DISABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. campaign_runs — one row per launched campaign
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS campaign_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipe_id           text NOT NULL,
  recipe_version      integer NOT NULL,
  status              text NOT NULL DEFAULT 'draft',
  audience_segment    text,
  triggered_by        text NOT NULL,
  approved_by         text REFERENCES users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  launched_at         timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_runs_status_chk
    CHECK (status IN ('draft','pending_approval','publishing','live','paused','completed','aborted')),
  CONSTRAINT campaign_runs_trigger_chk
    CHECK (triggered_by IN ('owner_explicit','mr_mwikila_proactive')),
  CONSTRAINT campaign_runs_recipe_fk
    FOREIGN KEY (recipe_id, recipe_version)
    REFERENCES campaign_recipes(id, version)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS campaign_runs_tenant_status_idx
  ON campaign_runs(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS campaign_runs_recipe_idx
  ON campaign_runs(recipe_id, recipe_version);
CREATE INDEX IF NOT EXISTS campaign_runs_pending_idx
  ON campaign_runs(tenant_id, created_at DESC)
  WHERE status = 'pending_approval';
CREATE INDEX IF NOT EXISTS campaign_runs_approved_by_idx
  ON campaign_runs(approved_by);

-- -----------------------------------------------------------------------------
-- 3. campaign_assets — one row per published asset
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS campaign_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel             text NOT NULL,
  asset_class         text NOT NULL,
  variant_id          text NOT NULL,
  artifact_ref        jsonb NOT NULL,
  publish_state       text NOT NULL DEFAULT 'pending',
  published_at        timestamptz,
  channel_post_id     text,
  utm_tags            jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_hash          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_assets_publish_chk
    CHECK (publish_state IN ('pending','published','failed','withdrawn'))
);

CREATE INDEX IF NOT EXISTS campaign_assets_run_idx
  ON campaign_assets(run_id);
CREATE INDEX IF NOT EXISTS campaign_assets_tenant_published_idx
  ON campaign_assets(tenant_id, published_at DESC);
CREATE INDEX IF NOT EXISTS campaign_assets_channel_idx
  ON campaign_assets(channel, publish_state);
CREATE INDEX IF NOT EXISTS campaign_assets_audit_hash_idx
  ON campaign_assets(audit_hash);
CREATE INDEX IF NOT EXISTS campaign_assets_variant_idx
  ON campaign_assets(run_id, variant_id);

-- -----------------------------------------------------------------------------
-- 4. marketing_telemetry_events — impression/click/conversion feed
-- -----------------------------------------------------------------------------
-- tenant_id denormalised so worker nightly aggregations skip a join.

CREATE TABLE IF NOT EXISTS marketing_telemetry_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            uuid NOT NULL REFERENCES campaign_assets(id) ON DELETE CASCADE,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_kind          text NOT NULL,
  channel             text NOT NULL,
  visitor_segment     text,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_telemetry_events_kind_chk
    CHECK (event_kind IN ('impression','click','engagement','conversion','share','comment'))
);

CREATE INDEX IF NOT EXISTS marketing_telemetry_events_asset_kind_idx
  ON marketing_telemetry_events(asset_id, event_kind);
CREATE INDEX IF NOT EXISTS marketing_telemetry_events_tenant_recorded_idx
  ON marketing_telemetry_events(tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS marketing_telemetry_events_kind_recorded_idx
  ON marketing_telemetry_events(event_kind, recorded_at DESC);
CREATE INDEX IF NOT EXISTS marketing_telemetry_events_channel_idx
  ON marketing_telemetry_events(channel, recorded_at DESC);

-- -----------------------------------------------------------------------------
-- 5. marketing_ab_results — per-variant Bayesian results
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketing_ab_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  variant_id          text NOT NULL,
  samples             integer NOT NULL DEFAULT 0,
  conversions         integer NOT NULL DEFAULT 0,
  bayes_posterior     numeric(5,4),
  is_winner           boolean,
  promoted_at         timestamptz,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_ab_results_samples_chk CHECK (samples >= 0),
  CONSTRAINT marketing_ab_results_conv_chk CHECK (conversions >= 0)
);

CREATE INDEX IF NOT EXISTS marketing_ab_results_run_idx
  ON marketing_ab_results(run_id);
CREATE INDEX IF NOT EXISTS marketing_ab_results_winner_idx
  ON marketing_ab_results(run_id, is_winner) WHERE is_winner = true;
CREATE INDEX IF NOT EXISTS marketing_ab_results_tenant_idx
  ON marketing_ab_results(tenant_id, computed_at DESC);

-- -----------------------------------------------------------------------------
-- 6. marketing_compliance_scans — per-asset compliance scan results
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketing_compliance_scans (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id                    uuid NOT NULL REFERENCES campaign_assets(id) ON DELETE CASCADE,
  tenant_id                   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uncited_claims              jsonb NOT NULL DEFAULT '[]'::jsonb,
  forbidden_phrases_found     text[] NOT NULL DEFAULT ARRAY[]::text[],
  missing_disclaimers         text[] NOT NULL DEFAULT ARRAY[]::text[],
  geo_restriction_flags       text[] NOT NULL DEFAULT ARRAY[]::text[],
  scan_passed                 boolean NOT NULL,
  scanned_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_compliance_scans_asset_idx
  ON marketing_compliance_scans(asset_id);
CREATE INDEX IF NOT EXISTS marketing_compliance_scans_failed_idx
  ON marketing_compliance_scans(tenant_id, scanned_at DESC)
  WHERE scan_passed = false;
CREATE INDEX IF NOT EXISTS marketing_compliance_scans_tenant_idx
  ON marketing_compliance_scans(tenant_id, scanned_at DESC);

-- -----------------------------------------------------------------------------
-- 7. Row Level Security — tenant-scoped tables
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'campaign_runs',
    'campaign_assets',
    'marketing_telemetry_events',
    'marketing_ab_results',
    'marketing_compliance_scans'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

COMMIT;
