-- =============================================================================
-- DOWN 0279 — reverse site damage settlement + mine rehabilitation (mining).
--
-- Drops the three damage-settlement / rehabilitation tables, their RLS
-- policies, CHECK constraints, and indexes. DATA LOSS: any in-flight claims,
-- rehabilitation plans, and action plans are discarded — dev/staging only.
--
-- Drop order respects FK dependency: rehabilitation_action_plans references
-- site_rehabilitation_plans, so it is dropped first (CASCADE makes order
-- moot, but explicit ordering keeps intent clear). contractor_damage_claims is
-- independent of the rehabilitation tables.
--
-- Idempotent: DROP TABLE IF EXISTS cascades each table's policy, constraints,
-- and indexes. Safe to re-run.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS rehabilitation_action_plans CASCADE;
DROP TABLE IF EXISTS site_rehabilitation_plans CASCADE;
DROP TABLE IF EXISTS contractor_damage_claims CASCADE;

COMMIT;
