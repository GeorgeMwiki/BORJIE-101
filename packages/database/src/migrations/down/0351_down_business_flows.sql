-- =============================================================================
-- Down-migration 0351 — drop business_flows + flow_runs.
--
-- Dev/staging only — DATA LOSS. Reverses 0351_business_flows.sql.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS flow_runs CASCADE;
DROP TABLE IF EXISTS business_flows CASCADE;

COMMIT;
