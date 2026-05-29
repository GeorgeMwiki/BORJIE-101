-- =============================================================================
-- Migration 0139 — device_push_tokens
--
-- Closes the bidirectional notification receiver loop. The notification
-- dispatcher (`services/notifications/src/dispatcher.ts`) + Firebase push
-- provider already exist; what was missing is the *registration* table so
-- the api-gateway can resolve "user X is on workforce-mobile + buyer-mobile,
-- send the push to BOTH tokens" at dispatch time.
--
-- One row per (user, app, token) triple. The composite uniqueness key
-- collapses re-registrations from the same device into a single row
-- (so reinstalls don't pile up dead tokens). The `revoked_at` column
-- soft-deletes tokens that the provider has explicitly told us are
-- invalid (FCM `UNREGISTERED`, APNS `Unregistered`) so they're skipped
-- on dispatch without losing the audit trail.
--
-- Companion files:
--   - services/api-gateway/src/routes/me/device-tokens.hono.ts
--   - apps/workforce-mobile/src/lib/push-register.ts
--   - apps/buyer-mobile/src/lib/push-register.ts
--
-- Tenant scope: tenant_id::text = current_setting('app.current_tenant_id', true)
-- RLS FORCE-enabled per CLAUDE.md hard rule. Forward-only.
-- IMMUTABLE: do not edit after merge; append a new file.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid         NOT NULL,
  /** Supabase user id (`auth.users.id`) — text to match the rest of the
   *  Borjie code that quotes the uuid to a string. */
  user_id           text         NOT NULL,
  /** ios | android | web */
  platform          text         NOT NULL,
  /** owner-web | admin-web | workforce-mobile | buyer-mobile */
  app               text         NOT NULL,
  /** Expo push token (ExponentPushToken[xxx]) when the app is built
   *  with EAS + expo-notifications. NULL on bare RN / web. */
  expo_push_token   text,
  /** FCM token — Android and bare-RN iOS via APNS-over-FCM. */
  fcm_token         text,
  /** Native APNS token — used only when bypassing FCM. NULL otherwise. */
  apns_token        text,
  installed_at      timestamptz  NOT NULL DEFAULT now(),
  last_seen_at      timestamptz  NOT NULL DEFAULT now(),
  /** Set when the provider tells us the token is unregistered. */
  revoked_at        timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'device_push_tokens_platform_chk'
  ) THEN
    ALTER TABLE device_push_tokens
      ADD CONSTRAINT device_push_tokens_platform_chk
      CHECK (platform IN ('ios', 'android', 'web'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'device_push_tokens_app_chk'
  ) THEN
    ALTER TABLE device_push_tokens
      ADD CONSTRAINT device_push_tokens_app_chk
      CHECK (app IN (
        'owner-web', 'admin-web', 'workforce-mobile', 'buyer-mobile'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'device_push_tokens_at_least_one_chk'
  ) THEN
    ALTER TABLE device_push_tokens
      ADD CONSTRAINT device_push_tokens_at_least_one_chk
      CHECK (
        expo_push_token IS NOT NULL
        OR fcm_token IS NOT NULL
        OR apns_token IS NOT NULL
      );
  END IF;
END $$;

-- Composite uniqueness: re-registering the same (user, app, concatenated
-- token-triple) collapses to a single row via ON CONFLICT updates. The
-- COALESCE handles NULL tokens — a NULL slot contributes the empty string
-- so two-out-of-three matches still uniquely identify the device.
CREATE UNIQUE INDEX IF NOT EXISTS device_push_tokens_user_app_token_uq
  ON device_push_tokens (
    user_id,
    app,
    (COALESCE(expo_push_token, '') || '|' || COALESCE(fcm_token, '') || '|' || COALESCE(apns_token, ''))
  );

-- Hot path: dispatcher loads "all active tokens for user X, tenant Y".
CREATE INDEX IF NOT EXISTS device_push_tokens_tenant_user_active_idx
  ON device_push_tokens (tenant_id, user_id)
  WHERE revoked_at IS NULL;

-- Operational query: token health by app.
CREATE INDEX IF NOT EXISTS device_push_tokens_app_active_idx
  ON device_push_tokens (app)
  WHERE revoked_at IS NULL;

ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_push_tokens FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'device_push_tokens'
       AND policyname = 'device_push_tokens_tenant_isolation'
  ) THEN
    CREATE POLICY device_push_tokens_tenant_isolation
      ON device_push_tokens
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
