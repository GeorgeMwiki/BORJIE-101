-- =============================================================================
-- 0031: Outbound webhook delivery — attempts + dead-letter queue
-- =============================================================================
-- Used by services/api-gateway/src/workers/webhook-retry-worker.ts.
--
-- The retry worker consumes `WebhookDeliveryQueued` events, POSTs the payload
-- to a tenant-configured URL with an HMAC signature, and records the outcome
-- in `webhook_delivery_attempts`. After 5 failed attempts (exponential
-- backoff: 1s, 3s, 9s, 27s, 81s) the payload is moved to
-- `webhook_dead_letters` for manual inspection + replay.
-- =============================================================================

CREATE TABLE IF NOT EXISTS webhook_delivery_attempts (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Stable identity of the outbound delivery — multiple attempts share the
  -- same delivery_id so we can group them for observability.
  delivery_id      TEXT NOT NULL,
  target_url       TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  attempt_number   INTEGER NOT NULL CHECK (attempt_number >= 1 AND attempt_number <= 10),
  status           TEXT NOT NULL
                   CHECK (status IN ('pending', 'succeeded', 'failed', 'abandoned')),
  status_code      INTEGER,
  response_body    TEXT,
  error_message    TEXT,
  scheduled_for    TIMESTAMPTZ NOT NULL,
  attempted_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_attempts_tenant
  ON webhook_delivery_attempts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_attempts_delivery
  ON webhook_delivery_attempts (delivery_id);
CREATE INDEX IF NOT EXISTS idx_webhook_attempts_pending
  ON webhook_delivery_attempts (status, scheduled_for)
  WHERE status = 'pending';


CREATE TABLE IF NOT EXISTS webhook_dead_letters (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  delivery_id      TEXT NOT NULL,
  target_url       TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  total_attempts   INTEGER NOT NULL,
  last_status_code INTEGER,
  last_error       TEXT,
  first_attempt_at TIMESTAMPTZ NOT NULL,
  last_attempt_at  TIMESTAMPTZ NOT NULL,
  -- Replay bookkeeping — set when an operator replays via the admin API.
  replayed_at      TIMESTAMPTZ,
  replayed_by      TEXT,
  replay_delivery_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_dlq_tenant
  ON webhook_dead_letters (tenant_id);
CREATE INDEX IF NOT EXISTS idx_webhook_dlq_created
  ON webhook_dead_letters (created_at DESC);
