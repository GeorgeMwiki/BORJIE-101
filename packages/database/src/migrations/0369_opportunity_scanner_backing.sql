-- =============================================================================
-- Migration 0369 — opportunity-scanner backing tables (Wave OWNER-OS).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The opportunity scanner
-- (services/api-gateway/src/services/opportunity-scanner/resolver.ts) reads a
-- per-tenant `ScanState` snapshot so Mr. Mwikila can surface UPSIDE (cost
-- savings, revenue, tax windows, capital routing, etc.). Roughly half of the
-- 33 rules read from base tables that ALREADY exist (shift_reports,
-- ore_parcels, estate_entities, insurance_policies, succession_plans,
-- workforce_certifications, procurement_*) — those slices COMPUTE from real
-- data and are handled entirely in the resolver.
--
-- The OTHER half read from owner-provided reference/state tables that never
-- shipped a migration — they were phantom relations the resolver caught and
-- degraded to null, so those rules could NEVER fire. That is the false-green
-- this migration kills: the tables are created here (FORCE RLS + tenant
-- isolation + service-role bypass) and the companion seed
-- (scripts/seed-opportunity-scanner-backing.ts) populates the live demo/test
-- tenants with REAL representative mining values so every rule can fire on
-- real data.
--
-- Tables created (all genuinely owner-state, no existing source to compute
-- from):
--   * tra_royalty_election_state          — TRA quarterly royalty election
--   * nemc_amnesty_windows                 — NEMC compliance amnesty windows
--   * nemc_amnesty_qualifications          — per-tenant amnesty qualification
--   * marketplace_buyer_offers             — recent buyer offers on parcels
--   * marketplace_buyers                   — KYC-clean buyer directory
--   * tenant_loans                         — outstanding facility balances
--   * tenant_cash_positions                — cash accounts + idle-days
--   * tenant_energy_profile                — grid vs solar-hybrid tariffs
--   * tenant_operations_profile            — night-shift / haul / stockpile ops
--   * tenant_operational_patterns          — patterns the tenant runs
--   * vendor_spend_rollup                  — annual spend per procurement cat
--   * workforce_apprenticeship_eligibility — VETA apprenticeship-eligible staff
--   * forestry_carbon_eligibility          — carbon-credit eligible hectares
--   * peer_cohort_tenant_position          — tenant's production percentile
--   * peer_cohort_top_patterns             — p75-cohort winning pattern
--
-- NOT created here (owned by other tracks / already live):
--   * external_benchmarks, peer_cohort_aggregates — pre-exist (BENCH track
--     seeds the reference metrics; the resolver reads them fail-soft).
--   * bot_gold_windows — created + seeded by the BENCH track; the fx slice
--     reads it fail-soft.
--
-- TENANT SCOPE (CLAUDE.md hard rule): every table gets ENABLE + FORCE ROW
-- LEVEL SECURITY, a tenant-isolation policy on the canonical
-- `app.current_tenant_id` GUC, a service-role bypass (the resolver reads
-- under app.current_tenant_id; a future ingest/refresh cron writes out-of-band
-- via withServiceRoleContext), and a guarded anon REVOKE. Mirrors 0348.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): CREATE TABLE IF NOT
-- EXISTS + CREATE INDEX IF NOT EXISTS + pg_policies-guarded CREATE POLICY +
-- pg_roles-guarded anon REVOKE. Re-run is a pure no-op. Every NOT NULL sits on
-- a freshly-created column (no backfill hazard) so the NOT-NULL safety
-- validator passes.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/opportunity-scanner-backing.schema.ts
--   * scripts/seed-opportunity-scanner-backing.ts
--   * services/api-gateway/src/services/opportunity-scanner/resolver.ts
--   * packages/database/src/migrations/down/0369_down_opportunity_scanner_backing.sql
-- =============================================================================

BEGIN;

-- ─── tra_royalty_election_state ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tra_royalty_election_state (
  id                text        PRIMARY KEY,
  tenant_id         text        NOT NULL,
  next_deadline     timestamptz NOT NULL,
  current_rate_pct  numeric     NOT NULL,
  alt_rate_pct      numeric     NOT NULL,
  last_quarter_tzs  numeric     NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tra_royalty_election_state_tenant_idx
  ON tra_royalty_election_state (tenant_id, computed_at DESC);

-- ─── nemc_amnesty_windows ───────────────────────────────────────────
-- Regulatory-window reference: NOT tenant-scoped by row (a window is a
-- calendar fact shared by all tenants) but still RLS-guarded so no tenant
-- context can read across a per-tenant column. We tag every row with the
-- sentinel tenant_id NULL semantics via a shared read; to keep the resolver
-- read RLS-clean we scope it per-tenant is NOT possible — instead we mark it
-- a shared reference table with a public-read policy (like marketplace public
-- read). It carries no tenant column.
CREATE TABLE IF NOT EXISTS nemc_amnesty_windows (
  id                            text        PRIMARY KEY,
  starts_at                     timestamptz NOT NULL,
  ends_at                       timestamptz NOT NULL,
  is_open                       boolean     NOT NULL DEFAULT true,
  estimated_penalty_avoided_tzs numeric     NOT NULL,
  notes                         text,
  created_at                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nemc_amnesty_windows_window_idx
  ON nemc_amnesty_windows (starts_at DESC, ends_at DESC);

-- ─── nemc_amnesty_qualifications ────────────────────────────────────
CREATE TABLE IF NOT EXISTS nemc_amnesty_qualifications (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  amnesty_id   text        NOT NULL,
  qualified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nemc_amnesty_qualifications_tenant_idx
  ON nemc_amnesty_qualifications (tenant_id, amnesty_id);

-- ─── marketplace_buyer_offers ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_buyer_offers (
  id                     text        PRIMARY KEY,
  tenant_id              text        NOT NULL,
  buyer_name             text        NOT NULL,
  premium_over_fix_pct   numeric     NOT NULL,
  ozt_equivalent         numeric     NOT NULL,
  offered_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_buyer_offers_tenant_idx
  ON marketplace_buyer_offers (tenant_id, offered_at DESC);

-- ─── marketplace_buyers ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_buyers (
  id                          text        PRIMARY KEY,
  tenant_id                   text        NOT NULL,
  name                        text        NOT NULL,
  kyc_status                  text        NOT NULL DEFAULT 'clean',
  recent_premium_over_fix_pct numeric     NOT NULL DEFAULT 0,
  recent_parcel_oz            numeric     NOT NULL DEFAULT 0,
  last_settlement_at          timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketplace_buyers_tenant_idx
  ON marketplace_buyers (tenant_id, recent_premium_over_fix_pct DESC);

-- ─── tenant_loans ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_loans (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  lender       text        NOT NULL,
  rate_pct     numeric     NOT NULL,
  balance_tzs  numeric     NOT NULL,
  status       text        NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_loans_tenant_idx
  ON tenant_loans (tenant_id, status, balance_tzs DESC);

-- ─── tenant_cash_positions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_cash_positions (
  id          text        PRIMARY KEY,
  tenant_id   text        NOT NULL,
  account     text        NOT NULL,
  amount      numeric     NOT NULL,
  sat_days    integer     NOT NULL DEFAULT 0,
  as_of       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_cash_positions_tenant_idx
  ON tenant_cash_positions (tenant_id, as_of DESC);

-- ─── tenant_energy_profile ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_energy_profile (
  id                                text        PRIMARY KEY,
  tenant_id                         text        NOT NULL,
  current_grid_tariff_tzs_per_kwh   numeric     NOT NULL,
  solar_hybrid_tzs_per_kwh          numeric     NOT NULL,
  monthly_kwh_consumption           numeric     NOT NULL,
  computed_at                       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_energy_profile_tenant_idx
  ON tenant_energy_profile (tenant_id, computed_at DESC);

-- ─── tenant_operations_profile ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_operations_profile (
  id                                       text        PRIMARY KEY,
  tenant_id                                text        NOT NULL,
  night_shift_idle_capacity_pct            numeric,
  night_shift_fuel_delta_tzs_per_tonne     numeric,
  bcm_haul_distance_metres_mean            numeric,
  bcm_haul_distance_p25_metres             numeric,
  rejected_ore_tonnes_rolling_30d          numeric,
  downstream_processing_tzs_per_tonne      numeric,
  stockpile_age_p90_days                   integer,
  computed_at                              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_operations_profile_tenant_idx
  ON tenant_operations_profile (tenant_id, computed_at DESC);

-- ─── tenant_operational_patterns ────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_operational_patterns (
  id            text        PRIMARY KEY,
  tenant_id     text        NOT NULL,
  pattern_label text        NOT NULL,
  adopted_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_operational_patterns_tenant_idx
  ON tenant_operational_patterns (tenant_id, pattern_label);

-- ─── vendor_spend_rollup ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_spend_rollup (
  id                text        PRIMARY KEY,
  tenant_id         text        NOT NULL,
  category          text        NOT NULL,
  vendor_id         text        NOT NULL,
  annual_spend_tzs  numeric     NOT NULL,
  computed_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vendor_spend_rollup_tenant_idx
  ON vendor_spend_rollup (tenant_id, category);

-- ─── workforce_apprenticeship_eligibility ───────────────────────────
CREATE TABLE IF NOT EXISTS workforce_apprenticeship_eligibility (
  id                     text        PRIMARY KEY,
  tenant_id              text        NOT NULL,
  user_id                text        NOT NULL,
  eligible_window_ends_at timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_apprenticeship_eligibility_tenant_idx
  ON workforce_apprenticeship_eligibility (tenant_id, eligible_window_ends_at DESC);

-- ─── forestry_carbon_eligibility ────────────────────────────────────
CREATE TABLE IF NOT EXISTS forestry_carbon_eligibility (
  id                text        PRIMARY KEY,
  tenant_id         text        NOT NULL,
  parcel_ref        text        NOT NULL,
  eligible_hectares numeric     NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS forestry_carbon_eligibility_tenant_idx
  ON forestry_carbon_eligibility (tenant_id);

-- ─── peer_cohort_tenant_position ────────────────────────────────────
CREATE TABLE IF NOT EXISTS peer_cohort_tenant_position (
  id                     text        PRIMARY KEY,
  tenant_id              text        NOT NULL,
  production_percentile  integer     NOT NULL,
  computed_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS peer_cohort_tenant_position_tenant_idx
  ON peer_cohort_tenant_position (tenant_id, computed_at DESC);

-- ─── peer_cohort_top_patterns ───────────────────────────────────────
-- Cohort-level reference (winning pattern of the p75 cohort). Shared across
-- tenants — no tenant column; public-read policy.
CREATE TABLE IF NOT EXISTS peer_cohort_top_patterns (
  id                 text        PRIMARY KEY,
  cohort_key         text        NOT NULL,
  p75_pattern_label  text        NOT NULL,
  computed_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS peer_cohort_top_patterns_computed_idx
  ON peer_cohort_top_patterns (computed_at DESC);

-- -----------------------------------------------------------------------------
-- RLS — per-tenant tables: FORCE RLS + tenant isolation on app.current_tenant_id
-- + service-role bypass + guarded anon REVOKE. Mirrors 0348.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tra_royalty_election_state',
    'nemc_amnesty_qualifications',
    'marketplace_buyer_offers',
    'marketplace_buyers',
    'tenant_loans',
    'tenant_cash_positions',
    'tenant_energy_profile',
    'tenant_operations_profile',
    'tenant_operational_patterns',
    'vendor_spend_rollup',
    'workforce_apprenticeship_eligibility',
    'forestry_carbon_eligibility',
    'peer_cohort_tenant_position'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = tbl || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        tbl || '_tenant_isolation', tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = tbl || '_service_role_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
        || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
        tbl || '_service_role_bypass', tbl
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- RLS — shared reference tables (no tenant column): FORCE RLS + a public-read
-- policy (mirrors 0350 marketplace_public_read) so any tenant context can READ
-- the shared calendar/cohort facts, but writes require the service role. anon
-- stays revoked.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  ref_tables text[] := ARRAY['nemc_amnesty_windows', 'peer_cohort_top_patterns'];
BEGIN
  FOREACH tbl IN ARRAY ref_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = tbl || '_public_read'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT USING (true);',
        tbl || '_public_read', tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = tbl
         AND policyname = tbl || '_service_role_write'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
        || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
        tbl || '_service_role_write', tbl
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE tra_royalty_election_state IS
  'Owner-state: TRA quarterly royalty election window + current/alt rate. '
  'Feeds the opportunity scanner tax slice. FORCE RLS on app.current_tenant_id.';
COMMENT ON TABLE nemc_amnesty_windows IS
  'Shared reference: NEMC compliance-amnesty calendar windows. Public-read, '
  'service-role write. Feeds the opportunity scanner regulator slice.';

COMMIT;
