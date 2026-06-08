-- =============================================================================
-- Down-migration 0304 — reverse platform_announcements.fanned_out_at.
--
-- Dev/staging only. Dropping the column loses the per-announcement broadcast
-- fan-out marker; on a re-up the worker would treat every still-'sent'
-- announcement as un-fanned-out and could re-enqueue it. The per-row
-- UNIQUE (tenant_id, idempotency_key) on `notification_dispatch_log` still
-- blocks actual duplicate sends, so this is recoverable — but only run this
-- against a throwaway DB.
--
-- Reverses migration 0304_announcement_fanout.sql.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS idx_platform_announcements_fanout_pending;

ALTER TABLE platform_announcements
  DROP COLUMN IF EXISTS fanned_out_at;

COMMIT;
