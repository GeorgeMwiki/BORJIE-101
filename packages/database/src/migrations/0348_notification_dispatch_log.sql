-- =============================================================================
-- Migration 0348 — notification_dispatch_log: CREATE the per-recipient delivery
-- ledger that the notification rails have ALWAYS assumed exists.
--
-- WHY THIS MIGRATION EXISTS (closing a schema-ahead-of-migrations drift)
-- ---------------------------------------------------------------------
-- `notification_dispatch_log` is the spine of the notification rails: the
-- announcement fan-out worker + the in-app push port ENQUEUE `pending` rows;
-- the dispatch drain worker claims them (`pending` → `sending`), calls the
-- provider, and marks the outcome with retry/backoff + DLQ columns. The table
-- existed on LIVE via schema-ahead drift, but NO migration in the chain ever
-- created it — migrations 0315 (RLS tenant_id index) and 0342 (service-role
-- bypass) both reference it but GUARD on existence (`to_regclass(...) IS NULL
-- → CONTINUE`), so on a fresh DB (migration-apply-check.yml) they silently
-- skip it and the table is simply absent. That made the api-gateway production
-- bundle unable to map the Drizzle `notificationDispatchLog` object, and any
-- fresh-DB run of the notifications BFF / drain worker hit 42P01.
--
-- This migration creates the table so fresh DBs match live. Because 0315/0342
-- run BEFORE 0348 (lex order) and skipped this table, 0348 is SELF-CONTAINED:
-- it adds the tenant_id RLS policy AND the service-role bypass AND the indexes
-- itself, rather than relying on the earlier migrations.
--
-- COLUMN CONTRACT — the exact union of the live writers (never guessed):
--   * INSERT (workforce-deps-wiring / announcement-fanout / lease-expiry-cron):
--       id, tenant_id, user_id, customer_id, channel, recipient_address,
--       template_key, locale, payload, correlation_id, idempotency_key,
--       attempt_count, delivery_status, created_at, updated_at
--   * UPDATE (notification-dispatch/dispatcher-worker):
--       provider, provider_message_id, provider_error_code,
--       provider_error_message, last_attempt_at, next_retry_at,
--       dead_lettered_at, dead_letter_reason
--   * ON CONFLICT (tenant_id, idempotency_key) → UNIQUE (tenant_id, idem_key).
--
-- TENANT SCOPE (CLAUDE.md hard rule): FORCE ROW LEVEL SECURITY + a tenant-
-- isolation policy on the canonical `app.current_tenant_id` GUC + a service-
-- role bypass (the fan-out/drain run out-of-band via `withServiceRoleContext`,
-- exactly like the other spine tables in 0342). Guarded anon REVOKE.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): CREATE TABLE IF NOT
-- EXISTS + CREATE ... INDEX IF NOT EXISTS + pg_policies-guarded CREATE POLICY +
-- pg_roles-guarded anon REVOKE. On a fully-migrated / live DB (where the table
-- already exists) this is a pure no-op. Every NOT NULL is on a freshly-created
-- column (no backfill hazard) so the NOT-NULL safety validator passes.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/notification-dispatch-log.schema.ts
--   * services/api-gateway/src/routes/notifications.ts
--   * services/api-gateway/src/services/notification-dispatch/dispatcher-worker.ts
--   * packages/database/src/migrations/down/0348_down_notification_dispatch_log.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS notification_dispatch_log (
  id                     text        PRIMARY KEY,
  tenant_id              text        NOT NULL,
  -- In-app push recipient (workforce user).
  user_id                text,
  -- Customer recipient (e.g. lease-expiry alerts).
  customer_id            text,
  -- 'app_push' | 'email' | 'sms' | ...
  channel                text        NOT NULL,
  -- Resolved handle: email / E.164 / 'user:<id>' / 'unaddressed'.
  recipient_address      text        NOT NULL,
  -- Template key driving render (e.g. 'platform.announcement.broadcast').
  template_key           text        NOT NULL,
  locale                 text        NOT NULL DEFAULT 'en',
  payload                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  correlation_id         text,
  -- Per-tenant idempotency key — ON CONFLICT dedupe target.
  idempotency_key        text        NOT NULL,
  attempt_count          integer     NOT NULL DEFAULT 0,
  -- pending | sending | sent | failed.
  delivery_status        text        NOT NULL DEFAULT 'pending',
  -- Set on attempt by the drain worker.
  provider               text,
  provider_message_id    text,
  provider_error_code    text,
  provider_error_message text,
  last_attempt_at        timestamptz,
  next_retry_at          timestamptz,
  dead_lettered_at       timestamptz,
  dead_letter_reason     text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ON CONFLICT (tenant_id, idempotency_key) DO NOTHING — the enqueue dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS notification_dispatch_log_tenant_idem_key
  ON notification_dispatch_log (tenant_id, idempotency_key);

-- The drain worker's hot scan: rows for a tenant by delivery status.
CREATE INDEX IF NOT EXISTS notification_dispatch_log_tenant_status_idx
  ON notification_dispatch_log (tenant_id, delivery_status);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass (for the
-- out-of-band fan-out / drain cron) + guarded anon REVOKE. Mirrors 0341 / 0342.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text := 'notification_dispatch_log';
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
  EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = tbl
       AND policyname = tbl || '_tenant_isolation'
  ) THEN
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
      || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
      tbl || '_tenant_isolation', tbl
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = tbl
       AND policyname = tbl || '_service_role_bypass'
  ) THEN
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
      || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
      tbl || '_service_role_bypass', tbl
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
  END IF;
END $$;

COMMENT ON TABLE notification_dispatch_log IS
  'Per-recipient notification delivery ledger. The announcement fan-out + '
  'in-app push rails enqueue pending rows; the dispatch drain worker sends '
  'them and records the outcome (retry/backoff + DLQ). FORCE RLS on '
  'app.current_tenant_id + service-role bypass for the out-of-band cron. '
  'Existed on live via schema-ahead drift; created here for fresh DBs.';

COMMIT;
