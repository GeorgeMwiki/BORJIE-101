-- =============================================================================
-- Migration 0011 — Borjie junior agent output tables
--
-- Adds the typed Drizzle-backed tables that every junior agent in
-- packages/ai-copilot/src/juniors/* now writes to. Replaces the raw
-- `db.execute(sql\`INSERT...\`)` writes that targeted tables which did
-- not exist in the schema (issue #30).
--
-- Tables (all tenant-scoped, RLS-enabled):
--   decision_log, audit_log, compliance_verdicts, contract_remediation,
--   generated_reports, notifications_outbox,
--   licence_dormancy_scores, sample_batches, qaqc_results,
--   geology_scores, site_layouts, weekly_plans, sic_events,
--   shift_reconciliations, junior_drill_holes, junior_drill_hole_layers,
--   hr_summaries, asset_status_snapshots, procurement_recommendations,
--   unit_economics_snapshots, fx_snapshots, sales_advice,
--   buyer_kyc_records, safety_snapshots, grievance_records,
--   metallurgy_recommendations, risk_snapshots, forecast_snapshots,
--   junior_marketplace_listings, junior_csr_plans,
--   junior_maintenance_events.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Governance — master brain, auditor, compliance, contract auditor,
-- report writer, notifications router.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS decision_log (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mode          text NOT NULL,
  query         text NOT NULL,
  dispatch_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence    numeric(4,3),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decision_log_tenant_idx ON decision_log(tenant_id);
CREATE INDEX IF NOT EXISTS decision_log_tenant_created_idx ON decision_log(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recommendation jsonb NOT NULL DEFAULT '{}'::jsonb,
  verdict        text NOT NULL,
  missing        text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_idx ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS audit_log_verdict_idx ON audit_log(tenant_id, verdict);

CREATE TABLE IF NOT EXISTS compliance_verdicts (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_kind text NOT NULL,
  compliant   boolean NOT NULL,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compliance_verdicts_tenant_idx ON compliance_verdicts(tenant_id);
CREATE INDEX IF NOT EXISTS compliance_verdicts_action_idx ON compliance_verdicts(tenant_id, action_kind);

CREATE TABLE IF NOT EXISTS contract_remediation (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status              text NOT NULL,
  total_exposure_tzs  numeric(18,2),
  summary             jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_remediation_tenant_idx ON contract_remediation(tenant_id);
CREATE INDEX IF NOT EXISTS contract_remediation_status_idx ON contract_remediation(tenant_id, status);

CREATE TABLE IF NOT EXISTS generated_reports (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cadence     text NOT NULL,
  audience    text NOT NULL,
  language    text NOT NULL,
  title       text NOT NULL,
  word_count  integer NOT NULL DEFAULT 0,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS generated_reports_tenant_idx ON generated_reports(tenant_id);
CREATE INDEX IF NOT EXISTS generated_reports_cadence_idx ON generated_reports(tenant_id, cadence);

CREATE TABLE IF NOT EXISTS notifications_outbox (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient_user_id  text NOT NULL,
  category           text NOT NULL,
  severity           text NOT NULL,
  summary            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_outbox_tenant_idx ON notifications_outbox(tenant_id);
CREATE INDEX IF NOT EXISTS notifications_outbox_recipient_idx ON notifications_outbox(tenant_id, recipient_user_id);
CREATE INDEX IF NOT EXISTS notifications_outbox_category_idx ON notifications_outbox(tenant_id, category);

-- ---------------------------------------------------------------------------
-- Geology + operations — licence, lab assay, geology, mine planner,
-- operations SIC, drill-hole logger.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS licence_dormancy_scores (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  licence_id   text NOT NULL,
  score        numeric(4,2) NOT NULL,
  alert_level  text NOT NULL,
  factors      jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS licence_dormancy_scores_tenant_idx ON licence_dormancy_scores(tenant_id);
CREATE INDEX IF NOT EXISTS licence_dormancy_scores_licence_idx ON licence_dormancy_scores(tenant_id, licence_id);

CREATE TABLE IF NOT EXISTS sample_batches (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id           text,
  batch_id          text NOT NULL UNIQUE,
  mineral           text NOT NULL,
  recommended_lab   text,
  technique         text,
  cost_tzs          numeric(18,2),
  turnaround_days   integer,
  manifest          jsonb NOT NULL DEFAULT '{}'::jsonb,
  qaqc_passed       boolean,
  qaqc_failures     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sample_batches_tenant_idx ON sample_batches(tenant_id);
CREATE INDEX IF NOT EXISTS sample_batches_mineral_idx ON sample_batches(tenant_id, mineral);

CREATE TABLE IF NOT EXISTS qaqc_results (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  batch_id    text NOT NULL,
  passed      boolean NOT NULL,
  failures    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qaqc_results_tenant_idx ON qaqc_results(tenant_id);
CREATE INDEX IF NOT EXISTS qaqc_results_batch_idx ON qaqc_results(tenant_id, batch_id);

CREATE TABLE IF NOT EXISTS geology_scores (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id       text NOT NULL,
  mineral       text NOT NULL,
  score         numeric(4,2) NOT NULL,
  score_band    text NOT NULL,
  vein_model    jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS geology_scores_tenant_idx ON geology_scores(tenant_id);
CREATE INDEX IF NOT EXISTS geology_scores_site_mineral_idx ON geology_scores(tenant_id, site_id, mineral);

CREATE TABLE IF NOT EXISTS site_layouts (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id       text NOT NULL,
  sections      jsonb NOT NULL DEFAULT '{}'::jsonb,
  weekly_plan   jsonb NOT NULL DEFAULT '{}'::jsonb,
  match_factor  numeric(5,3),
  computed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_layouts_tenant_idx ON site_layouts(tenant_id);
CREATE INDEX IF NOT EXISTS site_layouts_site_idx ON site_layouts(tenant_id, site_id);

CREATE TABLE IF NOT EXISTS weekly_plans (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id     text NOT NULL,
  week_start  date NOT NULL,
  plan        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS weekly_plans_tenant_idx ON weekly_plans(tenant_id);
CREATE INDEX IF NOT EXISTS weekly_plans_site_week_idx ON weekly_plans(tenant_id, site_id, week_start);

CREATE TABLE IF NOT EXISTS sic_events (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id          text NOT NULL,
  shift_id         text,
  mode             text NOT NULL,
  supervisor_id    text,
  deviation_code   text,
  variance_tonnes  numeric(14,2),
  variance_pct     numeric(6,2),
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sic_events_tenant_idx ON sic_events(tenant_id);
CREATE INDEX IF NOT EXISTS sic_events_site_idx ON sic_events(tenant_id, site_id);
CREATE INDEX IF NOT EXISTS sic_events_shift_idx ON sic_events(tenant_id, shift_id);

CREATE TABLE IF NOT EXISTS shift_reconciliations (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id      text NOT NULL,
  shift_id     text NOT NULL,
  reconciled   boolean NOT NULL DEFAULT false,
  discrepancy  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_reconciliations_tenant_idx ON shift_reconciliations(tenant_id);
CREATE INDEX IF NOT EXISTS shift_reconciliations_shift_idx ON shift_reconciliations(tenant_id, shift_id);

CREATE TABLE IF NOT EXISTS junior_drill_holes (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id          text NOT NULL,
  hole_id          text NOT NULL UNIQUE,
  kind             text NOT NULL,
  gps              jsonb NOT NULL DEFAULT '{}'::jsonb,
  azimuth_deg      numeric(5,2),
  dip_deg          numeric(5,2),
  total_depth_m    numeric(8,2),
  vein_intersects  integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS junior_drill_holes_tenant_idx ON junior_drill_holes(tenant_id);
CREATE INDEX IF NOT EXISTS junior_drill_holes_site_idx ON junior_drill_holes(tenant_id, site_id);

CREATE TABLE IF NOT EXISTS junior_drill_hole_layers (
  id              text PRIMARY KEY,
  hole_id         text NOT NULL,
  idx             integer NOT NULL,
  depth_from_m    numeric(8,2) NOT NULL,
  depth_to_m      numeric(8,2) NOT NULL,
  vein_intersect  boolean NOT NULL DEFAULT false,
  fields          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS junior_drill_hole_layers_hole_idx ON junior_drill_hole_layers(hole_id);

-- ---------------------------------------------------------------------------
-- Commercial + workforce + safety + risk
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hr_summaries (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reporting_month   text NOT NULL,
  summary           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_summaries_tenant_idx ON hr_summaries(tenant_id);
CREATE INDEX IF NOT EXISTS hr_summaries_month_idx ON hr_summaries(tenant_id, reporting_month);

CREATE TABLE IF NOT EXISTS asset_status_snapshots (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fleet_health      text NOT NULL,
  utilisation_pct   numeric(5,2),
  summary           jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_status_snapshots_tenant_idx ON asset_status_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS asset_status_snapshots_health_idx ON asset_status_snapshots(tenant_id, fleet_health);

CREATE TABLE IF NOT EXISTS procurement_recommendations (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id     text,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS procurement_recommendations_tenant_idx ON procurement_recommendations(tenant_id);
CREATE INDEX IF NOT EXISTS procurement_recommendations_site_idx ON procurement_recommendations(tenant_id, site_id);

CREATE TABLE IF NOT EXISTS unit_economics_snapshots (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id     text,
  period      text NOT NULL,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS unit_economics_snapshots_tenant_idx ON unit_economics_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS unit_economics_snapshots_period_idx ON unit_economics_snapshots(tenant_id, period);

CREATE TABLE IF NOT EXISTS fx_snapshots (
  id                      text PRIMARY KEY,
  tenant_id               text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mode                    text NOT NULL,
  bot_rate_tzs_per_usd    numeric(12,4),
  summary                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fx_snapshots_tenant_idx ON fx_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS fx_snapshots_mode_idx ON fx_snapshots(tenant_id, mode);

CREATE TABLE IF NOT EXISTS sales_advice (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parcel_id             text NOT NULL,
  recommended_buyer_id  text,
  summary               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_advice_tenant_idx ON sales_advice(tenant_id);
CREATE INDEX IF NOT EXISTS sales_advice_parcel_idx ON sales_advice(tenant_id, parcel_id);

CREATE TABLE IF NOT EXISTS buyer_kyc_records (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  buyer_id    text NOT NULL,
  kyc_status  text NOT NULL,
  oecd_band   text,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS buyer_kyc_records_tenant_idx ON buyer_kyc_records(tenant_id);
CREATE INDEX IF NOT EXISTS buyer_kyc_records_buyer_idx ON buyer_kyc_records(tenant_id, buyer_id);
CREATE INDEX IF NOT EXISTS buyer_kyc_records_status_idx ON buyer_kyc_records(tenant_id, kyc_status);

CREATE TABLE IF NOT EXISTS safety_snapshots (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id             text,
  ppe_compliance_pct  numeric(5,2),
  summary             jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_snapshots_tenant_idx ON safety_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS safety_snapshots_site_idx ON safety_snapshots(tenant_id, site_id);

CREATE TABLE IF NOT EXISTS grievance_records (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grievance_records_tenant_idx ON grievance_records(tenant_id);

CREATE TABLE IF NOT EXISTS metallurgy_recommendations (
  id                      text PRIMARY KEY,
  tenant_id               text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id                 text,
  mineral_family          text NOT NULL,
  expected_recovery_pct   numeric(5,2),
  summary                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS metallurgy_recommendations_tenant_idx ON metallurgy_recommendations(tenant_id);
CREATE INDEX IF NOT EXISTS metallurgy_recommendations_mineral_idx ON metallurgy_recommendations(tenant_id, mineral_family);

CREATE TABLE IF NOT EXISTS risk_snapshots (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id           text,
  composite_score   numeric(5,2),
  band              text,
  summary           jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS risk_snapshots_tenant_idx ON risk_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS risk_snapshots_band_idx ON risk_snapshots(tenant_id, band);

CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id      text,
  kind         text NOT NULL,
  horizon_days integer NOT NULL,
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forecast_snapshots_tenant_idx ON forecast_snapshots(tenant_id);
CREATE INDEX IF NOT EXISTS forecast_snapshots_kind_idx ON forecast_snapshots(tenant_id, kind);

CREATE TABLE IF NOT EXISTS junior_marketplace_listings (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  participant_kind  text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS junior_marketplace_listings_tenant_idx ON junior_marketplace_listings(tenant_id);
CREATE INDEX IF NOT EXISTS junior_marketplace_listings_kind_idx ON junior_marketplace_listings(tenant_id, participant_kind);

CREATE TABLE IF NOT EXISTS junior_csr_plans (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  licence_id      text,
  status          text NOT NULL,
  delivered_pct   numeric(5,2),
  summary         jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS junior_csr_plans_tenant_idx ON junior_csr_plans(tenant_id);
CREATE INDEX IF NOT EXISTS junior_csr_plans_licence_idx ON junior_csr_plans(tenant_id, licence_id);

CREATE TABLE IF NOT EXISTS junior_maintenance_events (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id    text NOT NULL,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS junior_maintenance_events_tenant_idx ON junior_maintenance_events(tenant_id);
CREATE INDEX IF NOT EXISTS junior_maintenance_events_asset_idx ON junior_maintenance_events(tenant_id, asset_id);

-- ---------------------------------------------------------------------------
-- RLS — tenant_isolation policy on every junior-output table.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  junior_tables text[] := ARRAY[
    'decision_log', 'audit_log', 'compliance_verdicts',
    'contract_remediation', 'generated_reports', 'notifications_outbox',
    'licence_dormancy_scores', 'sample_batches', 'qaqc_results',
    'geology_scores', 'site_layouts', 'weekly_plans', 'sic_events',
    'shift_reconciliations', 'junior_drill_holes',
    'hr_summaries', 'asset_status_snapshots',
    'procurement_recommendations', 'unit_economics_snapshots',
    'fx_snapshots', 'sales_advice', 'buyer_kyc_records',
    'safety_snapshots', 'grievance_records',
    'metallurgy_recommendations', 'risk_snapshots',
    'forecast_snapshots', 'junior_marketplace_listings',
    'junior_csr_plans', 'junior_maintenance_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY junior_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      tbl
    );
  END LOOP;
END$$;

COMMIT;
