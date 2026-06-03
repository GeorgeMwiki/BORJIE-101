-- =============================================================================
-- DOWN 0276: revert brain sleep-pass durability tables (LP-21a).
--
-- DATA LOSS: drops brain_sleep_emissions then brain_sleep_runs and every row
-- in them (the overnight brain-job audit trail). Dev / staging only — never
-- run against a prod DB that holds run history you need to keep.
--
-- Reverses 0276_brain_sleep_runs.sql:
--   - DROP TABLE brain_sleep_emissions (FK child) first, then brain_sleep_runs.
--   - Policies + indexes drop with the tables.
--   - The anon/authenticated REVOKEs are mooted by the DROP (no role grants
--     survive a dropped table).
--
-- Idempotent: DROP TABLE IF EXISTS + CASCADE. Safe to re-run; safe whether or
-- not the tables exist.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS brain_sleep_emissions CASCADE;
DROP TABLE IF EXISTS brain_sleep_runs CASCADE;

COMMIT;
