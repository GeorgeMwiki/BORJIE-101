-- =============================================================================
-- 0091: Notification Dispatch Log
-- =============================================================================
-- Append-only log of every outbound notification attempt. Mirrors the drizzle
-- `notificationDispatchLog` schema in packages/database/src/schemas/messaging.
-- schema.ts. The Wave-18 notifications router reads from this table; without
-- it every GET /api/v1/notifications request 503s with `relation
-- "notification_dispatch_log" does not exist`.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS) so
-- repeated runs during dev/CI never fail.
-- =============================================================================

-- Delivery status enum (guard against re-create).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_delivery_status') THEN
    CREATE TYPE notification_delivery_status AS ENUM (
      'pending',
      'sent',
      'delivered',
      'read',
      'failed',
      'dead_lettered'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS notification_dispatch_log (
  id                      TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  user_id                 TEXT,
  customer_id             TEXT,

  channel                 TEXT NOT NULL,
  recipient_address       TEXT NOT NULL,
  template_key            TEXT NOT NULL,
  locale                  TEXT DEFAULT 'en',
  payload                 JSONB DEFAULT '{}'::jsonb,

  correlation_id          TEXT,
  idempotency_key         TEXT,

  attempt_count           INTEGER NOT NULL DEFAULT 0,

  delivery_status         notification_delivery_status NOT NULL DEFAULT 'pending',
  delivery_reported_at    TIMESTAMPTZ,

  provider                TEXT,
  provider_message_id     TEXT,
  provider_response       JSONB DEFAULT '{}'::jsonb,
  provider_error_code     TEXT,
  provider_error_message  TEXT,

  next_retry_at           TIMESTAMPTZ,
  last_attempt_at         TIMESTAMPTZ,

  dead_lettered_at        TIMESTAMPTZ,
  dead_letter_reason      TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-scoped recent listing (primary router query).
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_log_tenant_recent
  ON notification_dispatch_log (tenant_id, created_at DESC);

-- Per-recipient unread/search.
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_log_customer
  ON notification_dispatch_log (tenant_id, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notification_dispatch_log_user
  ON notification_dispatch_log (tenant_id, user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Retry sweep — background worker picks up rows where next_retry_at <= now().
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_log_retry_queue
  ON notification_dispatch_log (next_retry_at)
  WHERE delivery_status = 'pending' AND next_retry_at IS NOT NULL;

-- Idempotency — duplicates prevented by (tenant_id, idempotency_key).
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_dispatch_log_idempotency
  ON notification_dispatch_log (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Dead-letter triage view (admin dashboard).
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_log_dead_letter
  ON notification_dispatch_log (tenant_id, dead_lettered_at DESC)
  WHERE dead_lettered_at IS NOT NULL;
