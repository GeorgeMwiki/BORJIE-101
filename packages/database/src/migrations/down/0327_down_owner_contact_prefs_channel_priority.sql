-- =============================================================================
-- DOWN 0327 — drop owner_contact_prefs.channel_priority.
--
-- Reverses migration 0327. Idempotent (IF EXISTS). `preferred_channel` is
-- untouched (it predates 0327), so dropping this column restores the 0098
-- shape exactly.
-- =============================================================================

BEGIN;

ALTER TABLE owner_contact_prefs
  DROP COLUMN IF EXISTS channel_priority;

COMMIT;
