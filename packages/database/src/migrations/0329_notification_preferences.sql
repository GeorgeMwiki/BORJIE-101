-- =============================================================================
-- Migration 0329 — notification_preferences: durable per-user notification
-- channel/template toggles + quiet-hours (audit-fix owner-settings-2).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The /api/v1/me/notification-preferences surface was backed by an in-memory
-- echo stub: a PUT returned the payload back (looked like success) but the next
-- GET always returned the hard-coded empty default — every owner toggle
-- silently reverted on the next refetch / gateway restart (data loss).
--
-- This table persists the preference durably, one row per (tenant_id, user_id):
--   * channels   jsonb — per-channel on/off map, e.g. {"email":true,"sms":false}
--   * templates  jsonb — per-template on/off map, e.g. {"royalty_due":true}
--   * quiet_hours_start / quiet_hours_end text — "HH:MM" 24h window, or NULL.
-- The unique (tenant_id, user_id) index backs the gateway's upsert
-- (INSERT ... ON CONFLICT DO UPDATE).
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (`tenant_id` TEXT; no FK —
-- same repo shape as portal_tab_records / owner_contact_prefs). FORCE-enables
-- RLS with a tenant-isolation policy on the canonical `app.current_tenant_id`
-- GUC plus a service-role bypass, mirroring migration 0328 exactly. A TENANT can
-- NEVER read ANOTHER tenant's notification preferences.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is in
-- the CREATE TABLE WITH a DEFAULT (channels/templates '{}'::jsonb,
-- created_at/updated_at now()) so there is no backfill hazard and the NOT-NULL
-- safety validator passes.
--
-- Companion files:
--   * packages/database/src/schemas/notification-preferences.schema.ts
--   * services/api-gateway/src/routes/notification-preferences.router.ts
--   * services/api-gateway/src/index.ts (DB-backed PreferencesApi)
--   * packages/database/src/migrations/down/0329_down_notification_preferences.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- notification_preferences — one row per (tenant_id, user_id).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                 uuid          NOT NULL DEFAULT gen_random_uuid(),
  -- RLS isolation key (the owning tenant). No FK — text tenant id, repo shape.
  tenant_id          text          NOT NULL,
  -- The owning user (subject of the preferences).
  user_id            text          NOT NULL,
  -- Per-channel on/off toggles.
  channels           jsonb         NOT NULL DEFAULT '{}'::jsonb,
  -- Per-template on/off toggles.
  templates          jsonb         NOT NULL DEFAULT '{}'::jsonb,
  -- Quiet-hours window ("HH:MM" 24h), nullable; both set or both null.
  quiet_hours_start  text,
  quiet_hours_end    text,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT notification_preferences_pkey PRIMARY KEY (id)
);

-- Upsert key + hot read path: one row per (tenant_id, user_id).
CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_tenant_user_uniq
  ON notification_preferences (tenant_id, user_id);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass + guarded
-- anon REVOKE. Mirrors the 0328 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'notification_preferences'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = 'tenant_isolation_' || tbl
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        'tenant_isolation_' || tbl, tbl
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
  END LOOP;
END $$;

COMMIT;
