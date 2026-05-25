-- =============================================================================
-- Migration 0003 — Borjie mining-domain schema
--
-- 1. Drops legacy BossNyumba property tables.
-- 2. Installs PostGIS + pgvector + TimescaleDB extensions.
-- 3. Creates Borjie mining-domain tables (companies, licences, sites,
--    geology, workforce, fleet, production/sales, treasury, safety/CSR,
--    marketplace, intelligence corpus, fingerprint events, risks/tasks).
-- 4. Enables Row Level Security on every tenant-scoped table.
-- 5. Promotes `cash_balances` to a Timescale hypertable on `recorded_at`.
-- 6. Seeds one demo tenant `borjie-demo` (Dar es Salaam coords).
--
-- Idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;
-- TimescaleDB is optional in dev; cash_balances falls back to a plain table
-- when the extension is absent (see DO block near the bottom of this file).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'timescaledb extension not available — skipping';
END$$;
-- Apache AGE is optional for v1 (graph-on-Postgres); install if available.
-- Wrapped in DO block so absence does not fail the migration.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS age;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'apache_age extension not available — skipping';
END$$;

-- -----------------------------------------------------------------------------
-- 1. Drop legacy BossNyumba property-domain tables
-- -----------------------------------------------------------------------------
-- These tables were created by the legacy property migrations (0001*-0270*).
-- CASCADE removes dependent FKs, indexes, RLS policies, views.

-- Drop FK constraints from surviving AI-OS infra tables that still carry
-- legacy `customer_id` columns. Without this, the schema-defined Drizzle
-- column (now FK-less, see documents.schema.ts / communications.schema.ts)
-- would disagree with the live constraint until CASCADE catches up.
-- IF EXISTS makes each statement idempotent and safe on fresh databases.
ALTER TABLE IF EXISTS document_uploads
  DROP CONSTRAINT IF EXISTS document_uploads_customer_id_fkey;
ALTER TABLE IF EXISTS message_instances
  DROP CONSTRAINT IF EXISTS message_instances_customer_id_fkey;
ALTER TABLE IF EXISTS communication_consents
  DROP CONSTRAINT IF EXISTS communication_consents_customer_id_fkey;
ALTER TABLE IF EXISTS escalation_chain_runs
  DROP CONSTRAINT IF EXISTS escalation_chain_runs_customer_id_fkey;
ALTER TABLE IF EXISTS identity_profiles
  DROP CONSTRAINT IF EXISTS identity_profiles_customer_id_fkey;
ALTER TABLE IF EXISTS verification_badges
  DROP CONSTRAINT IF EXISTS verification_badges_customer_id_fkey;

DROP TABLE IF EXISTS
  vendor_assignments,
  vendor_scorecards,
  vendors,
  maintenance_requests,
  maintenance_problem_categories,
  maintenance_problems,
  inspection_signatures,
  inspection_items,
  inspection_ai_findings,
  inspection_extensions,
  inspections,
  utility_bills,
  utility_readings,
  utility_accounts,
  damage_deduction_cases,
  sublease_requests,
  unit_waitlists,
  scheduling_events,
  notice_service_receipts,
  compliance_notices,
  compliance_cases,
  compliance_items,
  compliance_exports,
  case_resolutions,
  case_timelines,
  cases,
  arrears_line_proposals,
  arrears_case_projections,
  arrears_cases,
  bids,
  tenders,
  marketplace_listings,
  negotiation_turns,
  negotiation_policies,
  negotiations,
  parcel_marketplace_inquiries,
  parcel_marketplace_listings,
  payment_event_store,
  payment_plan_agreements,
  payments,
  invoices,
  gepg_reconciliation_events,
  gepg_control_numbers,
  property_grade_snapshots,
  property_valuations,
  tenant_financial_statements,
  tenant_predictions,
  tenant_risk_reports,
  predictive_intervention_opportunities,
  intelligence_history,
  customer_preferences,
  customer_segment_memberships,
  customers,
  station_master_coverage,
  conditional_survey_action_plans,
  conditional_survey_findings,
  conditional_surveys,
  asset_components,
  leases,
  blocks,
  units,
  buildings,
  properties
CASCADE;

-- -----------------------------------------------------------------------------
-- 2. Tenants + users — add Borjie mining-domain columns
-- -----------------------------------------------------------------------------
-- The base columns are already created by earlier migrations. We add the
-- mining-domain plan / role / language / NIDA / biometric-hash columns.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'borjie_plan') THEN
    CREATE TYPE borjie_plan AS ENUM ('mwanzo','mkulima','mfanyabiashara','kampuni','group');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'borjie_user_role') THEN
    CREATE TYPE borjie_user_role AS ENUM (
      'owner','admin','site_manager','supervisor','driver','geologist',
      'stores','qc_officer','buyer','borjie_team'
    );
  END IF;
END$$;

ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS plan borjie_plan NOT NULL DEFAULT 'mkulima';

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS mining_role borjie_user_role NOT NULL DEFAULT 'owner',
  ADD COLUMN IF NOT EXISTS nida_id text,
  ADD COLUMN IF NOT EXISTS biometric_template_hash text,
  ADD COLUMN IF NOT EXISTS preferred_lang text NOT NULL DEFAULT 'sw';

-- -----------------------------------------------------------------------------
-- 3. Companies, directors, shareholders, bank accounts, authorities
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS companies (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               text NOT NULL,
  registration_no    text,
  tin                text,
  vrn                text,
  registered_address text,
  country            text NOT NULL DEFAULT 'TZ',
  attributes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS companies_tenant_idx ON companies(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS companies_reg_no_idx
  ON companies(tenant_id, registration_no);
CREATE INDEX IF NOT EXISTS companies_tin_idx ON companies(tin);

CREATE TABLE IF NOT EXISTS directors (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id    text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  nida_id       text,
  role          text NOT NULL,
  appointed_on  date,
  resigned_on   date,
  nationality   text NOT NULL DEFAULT 'TZ',
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS directors_tenant_idx ON directors(tenant_id);
CREATE INDEX IF NOT EXISTS directors_company_idx ON directors(company_id);

CREATE TABLE IF NOT EXISTS shareholders (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id    text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  holder_name   text NOT NULL,
  holder_kind   text NOT NULL,
  share_pct     numeric(7,4) NOT NULL,
  share_class   text NOT NULL DEFAULT 'ordinary',
  shares_issued numeric(18,0),
  nationality   text NOT NULL DEFAULT 'TZ',
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shareholders_tenant_idx ON shareholders(tenant_id);
CREATE INDEX IF NOT EXISTS shareholders_company_idx ON shareholders(company_id);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id     text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_name      text NOT NULL,
  branch         text,
  account_number text NOT NULL,
  currency       text NOT NULL DEFAULT 'TZS',
  swift_bic      text,
  purpose        text,
  is_active      text NOT NULL DEFAULT 'true',
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_accounts_tenant_idx ON bank_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS bank_accounts_company_idx ON bank_accounts(company_id);

CREATE TABLE IF NOT EXISTS authorities (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id    text REFERENCES companies(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  name          text NOT NULL,
  ref_number    text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS authorities_tenant_idx ON authorities(tenant_id);
CREATE INDEX IF NOT EXISTS authorities_company_idx ON authorities(company_id);
CREATE INDEX IF NOT EXISTS authorities_kind_idx ON authorities(kind);

-- -----------------------------------------------------------------------------
-- 4. Licences + licence events
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS licences (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id      text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  number          text NOT NULL,
  mineral         text NOT NULL,
  holder_user_id  text REFERENCES users(id) ON DELETE SET NULL,
  grant_date      date,
  expiry_date     date,
  area_ha         numeric(12,4),
  polygon         geography(POLYGON, 4326),
  status          text NOT NULL DEFAULT 'active',
  fees            jsonb NOT NULL DEFAULT '{}'::jsonb,
  obligations     jsonb NOT NULL DEFAULT '{}'::jsonb,
  dormancy_score  smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS licences_tenant_idx ON licences(tenant_id);
CREATE INDEX IF NOT EXISTS licences_company_idx ON licences(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS licences_number_kind_idx
  ON licences(tenant_id, kind, number);
CREATE INDEX IF NOT EXISTS licences_tenant_expiry_idx
  ON licences(tenant_id, expiry_date);
CREATE INDEX IF NOT EXISTS licences_status_idx ON licences(tenant_id, status);
CREATE INDEX IF NOT EXISTS licences_polygon_gix ON licences USING GIST(polygon);

CREATE TABLE IF NOT EXISTS licence_events (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  licence_id    text NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  summary       text,
  due_date      date,
  status        text NOT NULL DEFAULT 'open',
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_ids  text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS licence_events_tenant_idx ON licence_events(tenant_id);
CREATE INDEX IF NOT EXISTS licence_events_licence_idx ON licence_events(licence_id);
CREATE INDEX IF NOT EXISTS licence_events_status_due_idx
  ON licence_events(tenant_id, status, due_date);

-- -----------------------------------------------------------------------------
-- 5. Sites + site sections
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sites (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  licence_id         text NOT NULL REFERENCES licences(id) ON DELETE CASCADE,
  name               text NOT NULL,
  mineral            text NOT NULL,
  location           geography(POINT, 4326),
  polygon            geography(POLYGON, 4326),
  phase              text NOT NULL DEFAULT 'pre_licence',
  manager_user_id    text REFERENCES users(id) ON DELETE SET NULL,
  geology_confidence numeric(3,2) NOT NULL DEFAULT 0.10,
  status             text NOT NULL DEFAULT 'active',
  attributes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sites_tenant_idx ON sites(tenant_id);
CREATE INDEX IF NOT EXISTS sites_licence_idx ON sites(licence_id);
CREATE INDEX IF NOT EXISTS sites_phase_idx ON sites(tenant_id, phase);
CREATE INDEX IF NOT EXISTS sites_polygon_gix ON sites USING GIST(polygon);
CREATE INDEX IF NOT EXISTS sites_location_gix ON sites USING GIST(location);

CREATE TABLE IF NOT EXISTS site_sections (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id      text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  label        text,
  polygon      geography(POLYGON, 4326),
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_sections_tenant_idx ON site_sections(tenant_id);
CREATE INDEX IF NOT EXISTS site_sections_site_idx ON site_sections(site_id);
CREATE INDEX IF NOT EXISTS site_sections_kind_idx ON site_sections(site_id, kind);
CREATE INDEX IF NOT EXISTS site_sections_polygon_gix
  ON site_sections USING GIST(polygon);

-- -----------------------------------------------------------------------------
-- 6. Geology — drill holes, layers, samples, vein models
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS drill_holes (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id             text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hole_id_external    text NOT NULL,
  kind                text NOT NULL,
  collar_location     geography(POINT, 4326),
  azimuth_deg         numeric(5,2),
  dip_deg             numeric(5,2),
  total_depth_m       numeric(8,2),
  supervisor_user_id  text REFERENCES users(id) ON DELETE SET NULL,
  attributes          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drill_holes_tenant_idx ON drill_holes(tenant_id);
CREATE INDEX IF NOT EXISTS drill_holes_site_idx ON drill_holes(site_id);
CREATE INDEX IF NOT EXISTS drill_holes_kind_idx ON drill_holes(tenant_id, kind);
CREATE INDEX IF NOT EXISTS drill_holes_collar_gix
  ON drill_holes USING GIST(collar_location);

CREATE TABLE IF NOT EXISTS drill_hole_layers (
  id                         text PRIMARY KEY,
  tenant_id                  text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  hole_id                    text NOT NULL REFERENCES drill_holes(id) ON DELETE CASCADE,
  depth_from_m               numeric(8,2) NOT NULL,
  depth_to_m                 numeric(8,2) NOT NULL,
  lithology                  text,
  colour                     text,
  grain_size                 text,
  is_vein_intersect          boolean NOT NULL DEFAULT false,
  vein_width_m               numeric(6,3),
  vein_dip_deg               numeric(5,2),
  host_rock                  text,
  mineralisation_indicators  text[] NOT NULL DEFAULT ARRAY[]::text[],
  photo_url                  text,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drill_hole_layers_hole_idx ON drill_hole_layers(hole_id);
CREATE INDEX IF NOT EXISTS drill_hole_layers_tenant_idx ON drill_hole_layers(tenant_id);
CREATE INDEX IF NOT EXISTS drill_hole_layers_vein_idx
  ON drill_hole_layers(tenant_id, is_vein_intersect);

CREATE TABLE IF NOT EXISTS samples (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  drill_hole_id  text REFERENCES drill_holes(id) ON DELETE SET NULL,
  depth_m        numeric(8,2),
  sample_tag     text NOT NULL,
  mass_g         numeric(8,2),
  lab_id         text,
  sent_at        timestamptz,
  received_at    timestamptz,
  results_at     timestamptz,
  results        jsonb NOT NULL DEFAULT '{}'::jsonb,
  qa_qc          jsonb NOT NULL DEFAULT '{}'::jsonb,
  passed_qaqc    boolean,
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS samples_tenant_idx ON samples(tenant_id);
CREATE INDEX IF NOT EXISTS samples_hole_idx ON samples(drill_hole_id);
CREATE INDEX IF NOT EXISTS samples_tag_idx ON samples(tenant_id, sample_tag);
CREATE INDEX IF NOT EXISTS samples_qa_idx ON samples(tenant_id, passed_qaqc);

CREATE TABLE IF NOT EXISTS vein_models (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id           text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  length_m          numeric(10,2),
  width_m           numeric(8,3),
  thickness_true_m  numeric(8,3),
  dip_deg           numeric(5,2),
  strike_deg        numeric(5,2),
  plunge_deg        numeric(5,2),
  volume_m3         numeric(14,2),
  density_t_per_m3  numeric(5,2) NOT NULL DEFAULT 2.70,
  estimated_tonnes  numeric(14,2),
  grade_estimate    jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence        numeric(3,2),
  model_version     text,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vein_models_tenant_idx ON vein_models(tenant_id);
CREATE INDEX IF NOT EXISTS vein_models_site_idx ON vein_models(site_id);

-- -----------------------------------------------------------------------------
-- 7. Workforce — employees, attendance, advances
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS employees (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id       text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id          text REFERENCES users(id) ON DELETE SET NULL,
  site_id          text REFERENCES sites(id) ON DELETE SET NULL,
  full_name        text NOT NULL,
  nida_id          text,
  role             text NOT NULL,
  wage_basis       text NOT NULL DEFAULT 'daily',
  wage_rate_tzs    numeric(12,2),
  employment_type  text NOT NULL DEFAULT 'casual',
  nationality      text NOT NULL DEFAULT 'TZ',
  status           text NOT NULL DEFAULT 'active',
  start_date       date,
  end_date         date,
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employees_tenant_idx ON employees(tenant_id);
CREATE INDEX IF NOT EXISTS employees_company_idx ON employees(company_id);
CREATE INDEX IF NOT EXISTS employees_site_idx ON employees(site_id);
CREATE INDEX IF NOT EXISTS employees_nida_idx ON employees(nida_id);
CREATE INDEX IF NOT EXISTS employees_status_idx ON employees(tenant_id, status);

CREATE TABLE IF NOT EXISTS attendance (
  id                              text PRIMARY KEY,
  tenant_id                       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id                     text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  site_id                         text REFERENCES sites(id) ON DELETE SET NULL,
  work_date                       date NOT NULL,
  shift_kind                      text NOT NULL DEFAULT 'day',
  status                          text NOT NULL DEFAULT 'present',
  hours_worked                    numeric(5,2),
  signed_off_by_user_id           text REFERENCES users(id) ON DELETE SET NULL,
  signed_off_at                   timestamptz,
  signed_off_fingerprint_event_id text,
  notes                           text
);
CREATE INDEX IF NOT EXISTS attendance_tenant_idx ON attendance(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_employee_date_shift_idx
  ON attendance(employee_id, work_date, shift_kind);
CREATE INDEX IF NOT EXISTS attendance_site_date_idx ON attendance(site_id, work_date);

CREATE TABLE IF NOT EXISTS advances (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id         text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  amount_tzs          numeric(18,2) NOT NULL,
  currency            text NOT NULL DEFAULT 'TZS',
  reason_kind         text NOT NULL DEFAULT 'cash',
  reason_note         text,
  issued_at           timestamptz NOT NULL DEFAULT now(),
  issued_by_user_id   text REFERENCES users(id) ON DELETE SET NULL,
  repayment_schedule  jsonb NOT NULL DEFAULT '{}'::jsonb,
  repaid_tzs          numeric(18,2) NOT NULL DEFAULT 0,
  is_closed           boolean NOT NULL DEFAULT false,
  week_start          date,
  evidence_ids        text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS advances_tenant_idx ON advances(tenant_id);
CREATE INDEX IF NOT EXISTS advances_employee_idx ON advances(employee_id);
CREATE INDEX IF NOT EXISTS advances_open_idx ON advances(tenant_id, is_closed);
CREATE INDEX IF NOT EXISTS advances_week_idx ON advances(employee_id, week_start);

-- -----------------------------------------------------------------------------
-- 8. Assets / fleet — assets, maintenance events, fuel logs
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS assets (
  id                       text PRIMARY KEY,
  tenant_id                text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id               text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind                     text NOT NULL,
  make                     text,
  model                    text,
  year                     smallint,
  serial_number            text,
  owned                    boolean NOT NULL DEFAULT true,
  current_site_id          text REFERENCES sites(id) ON DELETE SET NULL,
  current_operator_user_id text REFERENCES users(id) ON DELETE SET NULL,
  total_hours              numeric(10,1) NOT NULL DEFAULT 0,
  status                   text NOT NULL DEFAULT 'operational',
  attributes               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_tenant_idx ON assets(tenant_id);
CREATE INDEX IF NOT EXISTS assets_company_idx ON assets(company_id);
CREATE INDEX IF NOT EXISTS assets_site_idx ON assets(current_site_id);
CREATE INDEX IF NOT EXISTS assets_kind_idx ON assets(tenant_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS assets_serial_idx
  ON assets(tenant_id, serial_number);

CREATE TABLE IF NOT EXISTS maintenance_events (
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id               text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind                   text NOT NULL,
  status                 text NOT NULL DEFAULT 'open',
  summary                text,
  downtime_hours         numeric(8,2),
  cost_tzs               numeric(14,2),
  parts_used             jsonb NOT NULL DEFAULT '[]'::jsonb,
  performed_by_user_id   text REFERENCES users(id) ON DELETE SET NULL,
  scheduled_for          timestamptz,
  started_at             timestamptz,
  completed_at           timestamptz,
  evidence_ids           text[] NOT NULL DEFAULT ARRAY[]::text[],
  attributes             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS maintenance_events_tenant_idx ON maintenance_events(tenant_id);
CREATE INDEX IF NOT EXISTS maintenance_events_asset_idx ON maintenance_events(asset_id);
CREATE INDEX IF NOT EXISTS maintenance_events_status_idx
  ON maintenance_events(tenant_id, status);

CREATE TABLE IF NOT EXISTS fuel_logs (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id              text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  site_id               text REFERENCES sites(id) ON DELETE SET NULL,
  log_date              date NOT NULL,
  fuel_kind             text NOT NULL DEFAULT 'diesel',
  litres                numeric(10,2) NOT NULL,
  price_per_litre_tzs   numeric(10,2),
  total_cost_tzs        numeric(14,2),
  meter_reading         numeric(10,1),
  issued_by_user_id     text REFERENCES users(id) ON DELETE SET NULL,
  received_by_user_id   text REFERENCES users(id) ON DELETE SET NULL,
  evidence_ids          text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fuel_logs_tenant_idx ON fuel_logs(tenant_id);
CREATE INDEX IF NOT EXISTS fuel_logs_asset_date_idx ON fuel_logs(asset_id, log_date);
CREATE INDEX IF NOT EXISTS fuel_logs_site_date_idx ON fuel_logs(site_id, log_date);

-- -----------------------------------------------------------------------------
-- 9. Production + sales
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shift_reports (
  id                              text PRIMARY KEY,
  tenant_id                       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id                         text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  supervisor_user_id              text REFERENCES users(id) ON DELETE SET NULL,
  shift_date                      date NOT NULL,
  shift_kind                      text NOT NULL DEFAULT 'day',
  workers_present                 smallint,
  machine_hours                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  fuel_litres                     numeric(10,2),
  metres_advanced                 numeric(8,2),
  bcm_overburden                  numeric(12,2),
  rom_tonnes                      numeric(12,2),
  blasts_fired                    smallint NOT NULL DEFAULT 0,
  delays                          jsonb NOT NULL DEFAULT '[]'::jsonb,
  incidents                       jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos                          text[] NOT NULL DEFAULT ARRAY[]::text[],
  next_shift_plan                 text,
  signed_off_at                   timestamptz,
  signed_off_fingerprint_event_id text,
  created_at                      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_reports_tenant_idx ON shift_reports(tenant_id);
CREATE INDEX IF NOT EXISTS shift_reports_site_date_idx
  ON shift_reports(site_id, shift_date);
CREATE UNIQUE INDEX IF NOT EXISTS shift_reports_site_date_kind_idx
  ON shift_reports(site_id, shift_date, shift_kind);

CREATE TABLE IF NOT EXISTS production_records (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id       text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  mass_kg       numeric(12,3),
  grade         jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovery_pct  numeric(5,2),
  ts            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_records_tenant_idx ON production_records(tenant_id);
CREATE INDEX IF NOT EXISTS production_records_site_ts_idx
  ON production_records(site_id, ts);

CREATE TABLE IF NOT EXISTS ore_parcels (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id           text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  mass_kg           numeric(12,3),
  grade             jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_location  text,
  status            text NOT NULL DEFAULT 'in_stockpile',
  photos            text[] NOT NULL DEFAULT ARRAY[]::text[],
  attributes        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ore_parcels_tenant_idx ON ore_parcels(tenant_id);
CREATE INDEX IF NOT EXISTS ore_parcels_site_idx ON ore_parcels(site_id);
CREATE INDEX IF NOT EXISTS ore_parcels_status_idx ON ore_parcels(tenant_id, status);

CREATE TABLE IF NOT EXISTS buyers (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  company_id    text REFERENCES companies(id) ON DELETE SET NULL,
  kind          text NOT NULL,
  country       text NOT NULL DEFAULT 'TZ',
  licence_number text,
  contact_name  text,
  contact_email text,
  contact_phone text,
  kyc_status    text NOT NULL DEFAULT 'pending',
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS buyers_tenant_idx ON buyers(tenant_id);
CREATE INDEX IF NOT EXISTS buyers_kind_idx ON buyers(tenant_id, kind);
CREATE INDEX IF NOT EXISTS buyers_kyc_idx ON buyers(tenant_id, kyc_status);

CREATE TABLE IF NOT EXISTS sales (
  id                      text PRIMARY KEY,
  tenant_id               text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parcel_id               text NOT NULL REFERENCES ore_parcels(id) ON DELETE CASCADE,
  buyer_id                text REFERENCES buyers(id) ON DELETE SET NULL,
  route                   text NOT NULL DEFAULT 'trader',
  weighbridge_doc_id      text,
  vehicle_plate           text,
  driver_user_id          text REFERENCES users(id) ON DELETE SET NULL,
  gross_price_usd         numeric(14,2),
  gross_price_tzs         numeric(18,2),
  fx_at_sale_tzs_per_usd  numeric(10,4),
  royalty_pct             numeric(5,2),
  inspection_pct          numeric(5,2),
  vat_pct                 numeric(5,2),
  other_levies            jsonb NOT NULL DEFAULT '{}'::jsonb,
  net_tzs                 numeric(18,2),
  payment_status          text NOT NULL DEFAULT 'pending',
  payment_received_at     timestamptz,
  ts                      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_tenant_idx ON sales(tenant_id);
CREATE INDEX IF NOT EXISTS sales_parcel_idx ON sales(parcel_id);
CREATE INDEX IF NOT EXISTS sales_buyer_idx ON sales(buyer_id);
CREATE INDEX IF NOT EXISTS sales_tenant_ts_idx ON sales(tenant_id, ts);
CREATE INDEX IF NOT EXISTS sales_payment_status_idx
  ON sales(tenant_id, payment_status);

-- -----------------------------------------------------------------------------
-- 10. Treasury — cash balances (Timescale hypertable), FX, prices, costs, forecasts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cash_balances (
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  company_id       text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id       text NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  recorded_at      timestamptz NOT NULL,
  balance_tzs      numeric(18,2) NOT NULL,
  balance_native   numeric(18,2),
  native_currency  text NOT NULL DEFAULT 'TZS',
  source           text NOT NULL DEFAULT 'manual',
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, account_id, recorded_at)
);
CREATE INDEX IF NOT EXISTS cash_balances_tenant_ts_idx
  ON cash_balances(tenant_id, recorded_at);
CREATE INDEX IF NOT EXISTS cash_balances_account_ts_idx
  ON cash_balances(account_id, recorded_at);

-- Promote cash_balances to a Timescale hypertable on recorded_at.
-- if_not_exists => safe to re-run.
-- timescaledb is optional in dev; wrap in DO so cash_balances falls back
-- to a regular table when the extension is not loaded.
DO $$
BEGIN
  PERFORM create_hypertable(
    'cash_balances',
    'recorded_at',
    if_not_exists => true,
    migrate_data => true
  );
EXCEPTION WHEN undefined_function THEN
  RAISE NOTICE '[0003] create_hypertable unavailable — cash_balances stays a plain table';
END$$;

CREATE TABLE IF NOT EXISTS fx_rates (
  id      text PRIMARY KEY,
  ts      timestamptz NOT NULL DEFAULT now(),
  pair    text NOT NULL,
  rate    numeric(12,6) NOT NULL,
  source  text NOT NULL DEFAULT 'BoT'
);
CREATE INDEX IF NOT EXISTS fx_rates_pair_ts_idx ON fx_rates(pair, ts);

CREATE TABLE IF NOT EXISTS mineral_prices (
  id       text PRIMARY KEY,
  ts       timestamptz NOT NULL DEFAULT now(),
  mineral  text NOT NULL,
  unit     text NOT NULL,
  price    numeric(14,4) NOT NULL,
  source   text NOT NULL DEFAULT 'LBMA'
);
CREATE INDEX IF NOT EXISTS mineral_prices_mineral_ts_idx
  ON mineral_prices(mineral, ts);

CREATE TABLE IF NOT EXISTS costs (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id          text REFERENCES sites(id) ON DELETE SET NULL,
  category         text NOT NULL,
  amount_tzs       numeric(18,2) NOT NULL,
  amount_currency  text NOT NULL DEFAULT 'TZS',
  amount_native    numeric(18,2),
  state            text NOT NULL DEFAULT 'actual',
  ts               timestamptz NOT NULL DEFAULT now(),
  evidence_id      text,
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS costs_tenant_idx ON costs(tenant_id);
CREATE INDEX IF NOT EXISTS costs_site_idx ON costs(site_id);
CREATE INDEX IF NOT EXISTS costs_category_idx ON costs(tenant_id, category);
CREATE INDEX IF NOT EXISTS costs_state_idx ON costs(tenant_id, state);
CREATE INDEX IF NOT EXISTS costs_tenant_ts_idx ON costs(tenant_id, ts);

CREATE TABLE IF NOT EXISTS forecasts (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope_kind     text NOT NULL,
  scope_id       text,
  metric         text NOT NULL,
  horizon_days   integer NOT NULL,
  low            numeric(20,4),
  mid            numeric(20,4),
  high           numeric(20,4),
  basis          text,
  model_version  text,
  as_of_date     date NOT NULL DEFAULT CURRENT_DATE,
  computed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forecasts_tenant_idx ON forecasts(tenant_id);
CREATE INDEX IF NOT EXISTS forecasts_scope_idx ON forecasts(tenant_id, scope_kind, scope_id);
CREATE INDEX IF NOT EXISTS forecasts_metric_idx ON forecasts(tenant_id, metric);

-- -----------------------------------------------------------------------------
-- 11. Safety + CSR — incidents, PPE, CSR plans, grievances, village meetings
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS incidents (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id              text REFERENCES sites(id) ON DELETE SET NULL,
  kind                 text NOT NULL,
  severity             text NOT NULL DEFAULT 'low',
  occurred_at          timestamptz NOT NULL,
  description          text,
  affected_user_ids    text[] NOT NULL DEFAULT ARRAY[]::text[],
  fatalities           smallint NOT NULL DEFAULT 0,
  injuries             smallint NOT NULL DEFAULT 0,
  location             geography(POINT, 4326),
  status               text NOT NULL DEFAULT 'open',
  root_cause           text,
  corrective_actions   jsonb NOT NULL DEFAULT '[]'::jsonb,
  reported_by_user_id  text REFERENCES users(id) ON DELETE SET NULL,
  photos               text[] NOT NULL DEFAULT ARRAY[]::text[],
  evidence_ids         text[] NOT NULL DEFAULT ARRAY[]::text[],
  attributes           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_tenant_idx ON incidents(tenant_id);
CREATE INDEX IF NOT EXISTS incidents_site_idx ON incidents(site_id);
CREATE INDEX IF NOT EXISTS incidents_kind_idx ON incidents(tenant_id, kind);
CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents(tenant_id, status);
CREATE INDEX IF NOT EXISTS incidents_location_gix ON incidents USING GIST(location);

CREATE TABLE IF NOT EXISTS ppe_issues (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id            text REFERENCES sites(id) ON DELETE SET NULL,
  employee_id        text,
  ppe_kind           text NOT NULL,
  quantity           smallint NOT NULL DEFAULT 1,
  unit_cost_tzs      numeric(12,2),
  issued_at          timestamptz NOT NULL DEFAULT now(),
  issued_by_user_id  text REFERENCES users(id) ON DELETE SET NULL,
  next_due_on        date,
  evidence_ids       text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes              text
);
CREATE INDEX IF NOT EXISTS ppe_issues_tenant_idx ON ppe_issues(tenant_id);
CREATE INDEX IF NOT EXISTS ppe_issues_employee_idx ON ppe_issues(employee_id);
CREATE INDEX IF NOT EXISTS ppe_issues_due_idx ON ppe_issues(tenant_id, next_due_on);

CREATE TABLE IF NOT EXISTS csr_plans (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id              text REFERENCES sites(id) ON DELETE SET NULL,
  title                text NOT NULL,
  category             text NOT NULL,
  description          text,
  budget_tzs           numeric(18,2),
  spent_tzs            numeric(18,2) NOT NULL DEFAULT 0,
  planned_start        date,
  planned_end          date,
  actual_start         date,
  actual_end           date,
  status               text NOT NULL DEFAULT 'draft',
  village_id           text,
  beneficiaries_count  smallint,
  evidence_ids         text[] NOT NULL DEFAULT ARRAY[]::text[],
  attributes           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS csr_plans_tenant_idx ON csr_plans(tenant_id);
CREATE INDEX IF NOT EXISTS csr_plans_site_idx ON csr_plans(site_id);
CREATE INDEX IF NOT EXISTS csr_plans_status_idx ON csr_plans(tenant_id, status);

CREATE TABLE IF NOT EXISTS grievances (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id           text REFERENCES sites(id) ON DELETE SET NULL,
  raised_by_kind    text NOT NULL,
  raised_by_name    text,
  raised_by_contact text,
  category          text NOT NULL,
  summary           text,
  status            text NOT NULL DEFAULT 'open',
  raised_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolution_note   text,
  evidence_ids      text[] NOT NULL DEFAULT ARRAY[]::text[],
  attributes        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS grievances_tenant_idx ON grievances(tenant_id);
CREATE INDEX IF NOT EXISTS grievances_site_idx ON grievances(site_id);
CREATE INDEX IF NOT EXISTS grievances_status_idx ON grievances(tenant_id, status);

CREATE TABLE IF NOT EXISTS village_meetings (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id         text REFERENCES sites(id) ON DELETE SET NULL,
  village_name    text NOT NULL,
  location        geography(POINT, 4326),
  meeting_date    date NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled',
  chaired_by_name text,
  attendees       smallint,
  resolutions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  minutes_doc_id  text,
  evidence_ids    text[] NOT NULL DEFAULT ARRAY[]::text[],
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS village_meetings_tenant_idx ON village_meetings(tenant_id);
CREATE INDEX IF NOT EXISTS village_meetings_site_idx ON village_meetings(site_id);
CREATE INDEX IF NOT EXISTS village_meetings_date_idx
  ON village_meetings(tenant_id, meeting_date);
CREATE INDEX IF NOT EXISTS village_meetings_location_gix
  ON village_meetings USING GIST(location);

-- -----------------------------------------------------------------------------
-- 12. Marketplace — listings + ratings
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category        text NOT NULL,
  title           text NOT NULL,
  description     text,
  price_tzs       numeric(18,2),
  price_unit      text,
  location        geography(POINT, 4326),
  contact_user_id text REFERENCES users(id) ON DELETE SET NULL,
  visibility      text NOT NULL DEFAULT 'tanzania',
  status          text NOT NULL DEFAULT 'active',
  expires_at      timestamptz,
  photos          text[] NOT NULL DEFAULT ARRAY[]::text[],
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_listings_tenant_idx ON marketplace_listings(tenant_id);
CREATE INDEX IF NOT EXISTS marketplace_listings_category_idx ON marketplace_listings(category);
CREATE INDEX IF NOT EXISTS marketplace_listings_visibility_idx ON marketplace_listings(visibility);
CREATE INDEX IF NOT EXISTS marketplace_listings_status_idx ON marketplace_listings(status);
CREATE INDEX IF NOT EXISTS marketplace_listings_location_gix
  ON marketplace_listings USING GIST(location);

CREATE TABLE IF NOT EXISTS ratings (
  id            text PRIMARY KEY,
  tenant_id     text REFERENCES tenants(id) ON DELETE CASCADE,
  subject_id    text NOT NULL,
  subject_kind  text NOT NULL,
  rater_user_id text REFERENCES users(id) ON DELETE SET NULL,
  score         smallint NOT NULL,
  comment       text,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ratings_subject_idx ON ratings(subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS ratings_tenant_idx ON ratings(tenant_id);
CREATE INDEX IF NOT EXISTS ratings_score_idx ON ratings(subject_kind, score);

-- -----------------------------------------------------------------------------
-- 13. Intelligence corpus (pgvector)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intelligence_corpus_chunks (
  id                text PRIMARY KEY,
  tenant_id         text REFERENCES tenants(id) ON DELETE CASCADE,
  source_file       text NOT NULL,
  section           text,
  page              integer,
  text              text NOT NULL,
  embedding         vector(1024),
  url               text,
  language          text NOT NULL DEFAULT 'en',
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  superseded_by_id  text
);
CREATE INDEX IF NOT EXISTS intelligence_corpus_chunks_tenant_idx
  ON intelligence_corpus_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS intelligence_corpus_chunks_source_section_idx
  ON intelligence_corpus_chunks(source_file, section);
CREATE INDEX IF NOT EXISTS intelligence_corpus_chunks_lang_idx
  ON intelligence_corpus_chunks(language);
CREATE INDEX IF NOT EXISTS intelligence_corpus_chunks_superseded_idx
  ON intelligence_corpus_chunks(superseded_by_id);
CREATE INDEX IF NOT EXISTS intelligence_corpus_chunks_embedding_ivfflat
  ON intelligence_corpus_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- -----------------------------------------------------------------------------
-- 14. Fingerprint events
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fingerprint_events (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  document_id         text,
  biometric_hash      text NOT NULL,
  signed_at           timestamptz NOT NULL DEFAULT now(),
  geo                 geography(POINT, 4326),
  device_attestation  jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_for          text NOT NULL,
  subject_id          text,
  subject_kind        text,
  attributes          jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS fingerprint_events_tenant_idx ON fingerprint_events(tenant_id);
CREATE INDEX IF NOT EXISTS fingerprint_events_user_idx ON fingerprint_events(user_id);
CREATE INDEX IF NOT EXISTS fingerprint_events_signed_at_idx
  ON fingerprint_events(tenant_id, signed_at);
CREATE INDEX IF NOT EXISTS fingerprint_events_subject_idx
  ON fingerprint_events(subject_kind, subject_id);
CREATE INDEX IF NOT EXISTS fingerprint_events_doc_idx ON fingerprint_events(document_id);
CREATE INDEX IF NOT EXISTS fingerprint_events_geo_gix
  ON fingerprint_events USING GIST(geo);

-- -----------------------------------------------------------------------------
-- 15. Risks + tasks
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tasks (
  id                       text PRIMARY KEY,
  tenant_id                text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id            text REFERENCES users(id) ON DELETE SET NULL,
  title                    text NOT NULL,
  kind                     text NOT NULL,
  priority                 smallint NOT NULL DEFAULT 3,
  site_id                  text REFERENCES sites(id) ON DELETE SET NULL,
  licence_id               text REFERENCES licences(id) ON DELETE SET NULL,
  due_date                 date,
  required_evidence        text[] NOT NULL DEFAULT ARRAY[]::text[],
  dependencies             text[] NOT NULL DEFAULT ARRAY[]::text[],
  cost_implication_tzs     numeric(18,2),
  risk_if_delayed          text,
  status                   text NOT NULL DEFAULT 'open',
  ai_followup_cadence      text NOT NULL DEFAULT 'weekly',
  attributes               jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  closed_at                timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_tenant_idx ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks(owner_user_id);
CREATE INDEX IF NOT EXISTS tasks_site_idx ON tasks(site_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(tenant_id, due_date);

CREATE TABLE IF NOT EXISTS risks (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id        text REFERENCES sites(id) ON DELETE SET NULL,
  licence_id     text REFERENCES licences(id) ON DELETE SET NULL,
  kind           text NOT NULL,
  severity       text NOT NULL DEFAULT 'medium',
  description    text,
  mitigations    text[] NOT NULL DEFAULT ARRAY[]::text[],
  status         text NOT NULL DEFAULT 'open',
  likelihood     numeric(3,2),
  impact_tzs     numeric(18,2),
  owner_user_id  text REFERENCES users(id) ON DELETE SET NULL,
  evidence_ids   text[] NOT NULL DEFAULT ARRAY[]::text[],
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS risks_tenant_idx ON risks(tenant_id);
CREATE INDEX IF NOT EXISTS risks_site_idx ON risks(site_id);
CREATE INDEX IF NOT EXISTS risks_kind_idx ON risks(tenant_id, kind);
CREATE INDEX IF NOT EXISTS risks_status_idx ON risks(tenant_id, status);
CREATE INDEX IF NOT EXISTS risks_severity_idx ON risks(tenant_id, severity);

-- -----------------------------------------------------------------------------
-- 16. Temporal entity graph — add Borjie columns (confidence, evidence, source)
-- -----------------------------------------------------------------------------

ALTER TABLE IF EXISTS temporal_entities
  ADD COLUMN IF NOT EXISTS confidence numeric(3,2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS evidence_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'user:unknown';

-- -----------------------------------------------------------------------------
-- 17. Row Level Security — enable + tenant_isolation policy on every
--     tenant-scoped Borjie table. Reads the `app.tenant_id` GUC set by
--     the API gateway per request.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies','directors','shareholders','bank_accounts','authorities',
    'licences','licence_events',
    'sites','site_sections',
    'drill_holes','drill_hole_layers','samples','vein_models',
    'employees','attendance','advances',
    'assets','maintenance_events','fuel_logs',
    'shift_reports','production_records','ore_parcels','buyers','sales',
    'cash_balances','costs','forecasts',
    'incidents','ppe_issues','csr_plans','grievances','village_meetings',
    'marketplace_listings',
    'fingerprint_events',
    'tasks','risks'
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

-- intelligence_corpus_chunks: special policy — allow read when row is global
-- (tenant_id IS NULL) OR matches current tenant GUC.
ALTER TABLE intelligence_corpus_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_global ON intelligence_corpus_chunks;
CREATE POLICY tenant_or_global ON intelligence_corpus_chunks
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- ratings: tenant_id may be NULL for cross-tenant ratings; allow either.
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_or_global ON ratings;
CREATE POLICY tenant_or_global ON ratings
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.tenant_id', true)
  );

-- -----------------------------------------------------------------------------
-- 18. Seed — borjie-demo tenant + owner + company + Dar es Salaam pilot site
-- -----------------------------------------------------------------------------
-- Dar es Salaam reference coords: 6.7924°S, 39.2083°E (lon, lat).

INSERT INTO tenants (
  id, name, slug, status, subscription_tier, plan,
  primary_email, country, region
) VALUES (
  'borjie-demo', 'Borjie Demo Tenant', 'borjie-demo', 'active',
  'enterprise', 'kampuni',
  'demo@borjie.tz', 'TZ', 'af-south-1'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (
  id, tenant_id, email, first_name, last_name, status, is_owner,
  mining_role, preferred_lang
) VALUES (
  'borjie-demo-owner', 'borjie-demo', 'owner@borjie-demo.tz',
  'Demo', 'Owner', 'active', true, 'owner', 'sw'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO companies (id, tenant_id, name, country, attributes)
VALUES (
  'borjie-demo-company', 'borjie-demo',
  'Borjie Demo Mining Co. Ltd', 'TZ',
  '{"seed": true, "demo": true}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO licences (
  id, tenant_id, company_id, kind, number, mineral, status,
  grant_date, expiry_date, area_ha, polygon
) VALUES (
  'borjie-demo-licence', 'borjie-demo', 'borjie-demo-company',
  'PML', 'PML-DEMO-001', 'Au', 'active',
  CURRENT_DATE, CURRENT_DATE + INTERVAL '7 years', 9.5,
  ST_GeographyFromText(
    'SRID=4326;POLYGON((' ||
    '39.2080 -6.7926, ' ||
    '39.2086 -6.7926, ' ||
    '39.2086 -6.7922, ' ||
    '39.2080 -6.7922, ' ||
    '39.2080 -6.7926))'
  )
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sites (
  id, tenant_id, licence_id, name, mineral, phase, status,
  location, polygon, geology_confidence
) VALUES (
  'borjie-demo-site', 'borjie-demo', 'borjie-demo-licence',
  'Demo Pit 1 (Dar es Salaam)', 'Au', 'sampling', 'active',
  ST_GeographyFromText('SRID=4326;POINT(39.2083 -6.7924)'),
  ST_GeographyFromText(
    'SRID=4326;POLYGON((' ||
    '39.2081 -6.7925, ' ||
    '39.2085 -6.7925, ' ||
    '39.2085 -6.7923, ' ||
    '39.2081 -6.7923, ' ||
    '39.2081 -6.7925))'
  ),
  0.25
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =============================================================================
-- End of migration 0003_mining_domain.sql
-- =============================================================================
