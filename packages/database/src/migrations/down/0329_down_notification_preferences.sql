-- =============================================================================
-- DOWN 0329 — drop notification_preferences (audit-fix owner-settings-2).
-- Idempotent: DROP ... IF EXISTS. Policies fall with the table.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS notification_preferences CASCADE;

COMMIT;
