-- =============================================================================
-- Down-migration 0352 — drop the notification_dispatch_log receipt columns.
--
-- Dev/staging only. Reverses 0352_notification_delivery_receipts.sql by
-- dropping the additive receipt columns + the provider_message_id lookup
-- index. DROP COLUMN IF EXISTS discards any recorded receipt timestamps
-- (delivery/read/bounce confirmation history) — no money / licence / ledger
-- records are touched. On LIVE this would re-open the markSent 42703 false-
-- green that 0352 closed, so do not run against production.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS notification_dispatch_log_provider_msg_idx;

ALTER TABLE notification_dispatch_log
  DROP COLUMN IF EXISTS delivery_reported_at,
  DROP COLUMN IF EXISTS delivered_at,
  DROP COLUMN IF EXISTS read_at,
  DROP COLUMN IF EXISTS bounced_at,
  DROP COLUMN IF EXISTS bounce_reason;

COMMIT;
