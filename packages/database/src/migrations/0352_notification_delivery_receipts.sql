-- =============================================================================
-- Migration 0352 — notification_dispatch_log delivery-receipt columns.
--
-- WHY THIS MIGRATION EXISTS (closing two delivery-loop defects)
-- ---------------------------------------------------------------------
-- 1. FALSE-GREEN COLUMN DRIFT: the dispatch drain's markSent() UPDATE has
--    always written `delivery_reported_at`, but NO migration ever added the
--    column. On a fresh / migration-applied DB that UPDATE throws Postgres
--    42703 (column does not exist); the worker's try/catch swallows it into a
--    logger.warn and still reports sent:true, leaving every genuinely-sent row
--    stuck at delivery_status='sending' forever. This adds the column so the
--    sent-timestamp lands and the row reaches a terminal state.
--
-- 2. RECEIPT LOOP HAS NOWHERE TO LAND: provider delivery-status webhooks
--    (Twilio / Meta-WhatsApp / Africa's Talking) normalize to delivered / read
--    / bounced, but the log had no column to record them, so the tracking-and-
--    closing loop could never close. These additive timestamp columns let the
--    NotificationDeliveryStatus receipt subscriber record provider-confirmed
--    delivery / read / bounce on top of the send-lifecycle delivery_status.
--
-- DESIGN: delivery_status stays the SEND lifecycle (pending → sending → sent →
-- failed). Provider-confirmed receipt state is layered as nullable timestamps
-- (a row can be 'sent' AND delivered_at set AND read_at set) so bounce-driven
-- suppression and true delivery confirmation become possible without
-- overloading the lifecycle enum.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every column is added
-- with ADD COLUMN IF NOT EXISTS and is NULLABLE with no default — a pure
-- metadata-only change (no table rewrite, no lock-heavy backfill, no NOT-NULL
-- hazard) so the migration-safety validator passes and re-apply is a no-op.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/notification-dispatch-log.schema.ts
--   * services/api-gateway/src/services/notification-dispatch/dispatcher-worker.ts
--   * services/api-gateway/src/routes/notification-webhooks.router.ts
--   * packages/database/src/migrations/down/0352_down_notification_delivery_receipts.sql
-- =============================================================================

BEGIN;

ALTER TABLE notification_dispatch_log
  -- Provider-acked send time (written by the drain's markSent).
  ADD COLUMN IF NOT EXISTS delivery_reported_at timestamptz,
  -- Provider-confirmed delivery (delivery-status receipt webhook).
  ADD COLUMN IF NOT EXISTS delivered_at         timestamptz,
  -- Provider-confirmed read / open (WhatsApp read receipt, email open).
  ADD COLUMN IF NOT EXISTS read_at              timestamptz,
  -- Provider-confirmed bounce (hard / soft).
  ADD COLUMN IF NOT EXISTS bounced_at           timestamptz,
  -- Provider-supplied bounce reason.
  ADD COLUMN IF NOT EXISTS bounce_reason        text;

-- The receipt subscriber correlates inbound webhooks by provider_message_id
-- within a tenant; index that lookup so the closing loop is cheap at scale.
CREATE INDEX IF NOT EXISTS notification_dispatch_log_provider_msg_idx
  ON notification_dispatch_log (tenant_id, provider_message_id);

COMMENT ON COLUMN notification_dispatch_log.delivery_reported_at IS
  'When the provider acked the send (set by the drain markSent).';
COMMENT ON COLUMN notification_dispatch_log.delivered_at IS
  'Provider-confirmed delivery, from a delivery-status receipt webhook.';
COMMENT ON COLUMN notification_dispatch_log.read_at IS
  'Provider-confirmed read/open (WhatsApp read receipt, email open).';
COMMENT ON COLUMN notification_dispatch_log.bounced_at IS
  'Provider-confirmed bounce; pair with bounce_reason for suppression.';

COMMIT;
