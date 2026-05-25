-- Migration: notification_dispatch_log
-- Adds per-attempt delivery tracking for outbound notifications (SMS/WhatsApp/Email).
-- Companion to services/notifications/src/dispatcher.ts (SCAFFOLDED 8 + NEW 21).

DO $$ BEGIN
  CREATE TYPE "notification_delivery_status" AS ENUM (
    'pending',
    'queued',
    'sending',
    'sent',
    'delivered',
    'read',
    'failed',
    'bounced',
    'blocked',
    'expired',
    'unknown'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "notification_dispatch_log" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "user_id" text,
  "customer_id" text,
  "channel" text NOT NULL,
  "recipient_address" text NOT NULL,
  "template_key" text NOT NULL,
  "locale" text DEFAULT 'en',
  "payload" jsonb DEFAULT '{}'::jsonb,
  "correlation_id" text,
  "idempotency_key" text,
  "attempt_count" integer NOT NULL DEFAULT 0,
  "delivery_status" "notification_delivery_status" NOT NULL DEFAULT 'pending',
  "delivery_reported_at" timestamptz,
  "provider" text,
  "provider_message_id" text,
  "provider_response" jsonb DEFAULT '{}'::jsonb,
  "provider_error_code" text,
  "provider_error_message" text,
  "next_retry_at" timestamptz,
  "last_attempt_at" timestamptz,
  "dead_lettered_at" timestamptz,
  "dead_letter_reason" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "notification_dispatch_log_tenant_idx" ON "notification_dispatch_log" ("tenant_id");
CREATE INDEX IF NOT EXISTS "notification_dispatch_log_status_idx" ON "notification_dispatch_log" ("delivery_status");
CREATE INDEX IF NOT EXISTS "notification_dispatch_log_user_idx" ON "notification_dispatch_log" ("user_id");
CREATE INDEX IF NOT EXISTS "notification_dispatch_log_customer_idx" ON "notification_dispatch_log" ("customer_id");
CREATE INDEX IF NOT EXISTS "notification_dispatch_log_provider_msg_idx" ON "notification_dispatch_log" ("provider", "provider_message_id");
CREATE INDEX IF NOT EXISTS "notification_dispatch_log_next_retry_idx" ON "notification_dispatch_log" ("next_retry_at");
CREATE UNIQUE INDEX IF NOT EXISTS "notification_dispatch_log_idempotency_idx" ON "notification_dispatch_log" ("tenant_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "notification_dispatch_log_correlation_idx" ON "notification_dispatch_log" ("correlation_id");

-- Vendor rating computed-column fields (SCAFFOLDED 9)
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rating_last_computed_at" timestamptz;
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "rating_sample_size" integer DEFAULT 0;
