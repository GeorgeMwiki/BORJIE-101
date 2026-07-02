-- =============================================================================
-- Down-migration 0372 — drop the affective_profiles durable store.
--
-- Dev/staging only — DATA LOSS on affective_profiles (durable theory-of-mind
-- profiles). Reverses 0372_affective_profiles.sql (table + index + both RLS
-- policies fall with the table). The accumulator re-darks to the process-local
-- in-memory Map only — every persisted profile is lost and cross-replica /
-- restart continuity is gone. Only for a clean apply→reverse test on a
-- throwaway DB; never run against an environment carrying real profiles.
--
-- No money / licence / ledger records touched.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS affective_profiles CASCADE;

COMMIT;
