-- =============================================================================
-- Down-migration 0369 — drop the opportunity-scanner backing tables.
--
-- Dev/staging only — DATA LOSS. Drops every table created by 0369 (tables +
-- indexes + RLS policies fall with them). Only for a clean apply→reverse test
-- on a throwaway DB; never run against an environment with real owner state.
--
-- Reverses migration 0369_opportunity_scanner_backing.sql.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS tra_royalty_election_state CASCADE;
DROP TABLE IF EXISTS nemc_amnesty_windows CASCADE;
DROP TABLE IF EXISTS nemc_amnesty_qualifications CASCADE;
DROP TABLE IF EXISTS marketplace_buyer_offers CASCADE;
DROP TABLE IF EXISTS marketplace_buyers CASCADE;
DROP TABLE IF EXISTS tenant_loans CASCADE;
DROP TABLE IF EXISTS tenant_cash_positions CASCADE;
DROP TABLE IF EXISTS tenant_energy_profile CASCADE;
DROP TABLE IF EXISTS tenant_operations_profile CASCADE;
DROP TABLE IF EXISTS tenant_operational_patterns CASCADE;
DROP TABLE IF EXISTS vendor_spend_rollup CASCADE;
DROP TABLE IF EXISTS workforce_apprenticeship_eligibility CASCADE;
DROP TABLE IF EXISTS forestry_carbon_eligibility CASCADE;
DROP TABLE IF EXISTS peer_cohort_tenant_position CASCADE;
DROP TABLE IF EXISTS peer_cohort_top_patterns CASCADE;

COMMIT;
