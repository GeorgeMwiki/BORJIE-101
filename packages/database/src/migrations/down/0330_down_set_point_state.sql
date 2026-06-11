-- =============================================================================
-- DOWN 0330 — drop set_point_state (Wave-C C3 WIN-4 closed-loop set-point memory).
-- Idempotent: DROP ... IF EXISTS. Policies fall with the table.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS set_point_state CASCADE;

COMMIT;
