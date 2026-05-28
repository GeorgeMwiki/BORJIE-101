-- =============================================================================
-- Migration 0098 — Owner Contact Preferences (Wave OWNER-CONTACT-RESOLVER)
--
-- Companion to:
--   - services/api-gateway/src/services/owner-identity/resolver.ts
--   - services/api-gateway/src/workers/reminders-dispatch.worker.ts
--
-- One row per owner-eligible user (tenant_id, user_id). Stores the
-- preferred dispatch channel for reminders + daily brief, plus the
-- per-channel addresses. Slack handle is the literal `@handle` (we
-- map to user-id at dispatch time when the Slack admin token is
-- configured). Phone is E.164. Email lives on `users.email` already;
-- we keep an override here so a delivery-only address can be set
-- (e.g. the owner wants their PA copied without sharing login email).
--
-- preferred_channel constrains the dispatcher choice when the
-- reminder row itself does not specify a channel.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern. RLS is FORCE-enabled per the Borjie hard rule
-- (`CLAUDE.md`).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS owner_contact_prefs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  user_id             text        NOT NULL,
  /** Override email used by the dispatcher. NULL falls back to users.email. */
  email_override      text,
  /** E.164 phone number used for SMS / WhatsApp. */
  phone               text,
  /** Slack handle like @mwikila — resolved to user_id by the Slack adapter. */
  slack_handle        text,
  /** Preferred channel for owner-targeted dispatch. */
  preferred_channel   text        NOT NULL DEFAULT 'email',
  /** Preferred UI / dispatch language: 'sw' or 'en'. */
  locale              text        NOT NULL DEFAULT 'sw',
  /** IANA tz name, e.g. Africa/Dar_es_Salaam. */
  timezone            text        NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_contact_prefs_channel_chk
    CHECK (preferred_channel IN ('email', 'sms', 'slack', 'whatsapp')),
  CONSTRAINT owner_contact_prefs_locale_chk
    CHECK (locale IN ('sw', 'en'))
);

CREATE UNIQUE INDEX IF NOT EXISTS owner_contact_prefs_tenant_user_uniq
  ON owner_contact_prefs (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS owner_contact_prefs_tenant_idx
  ON owner_contact_prefs (tenant_id);

ALTER TABLE owner_contact_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_contact_prefs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_contact_prefs'
       AND policyname = 'owner_contact_prefs_tenant_isolation'
  ) THEN
    CREATE POLICY owner_contact_prefs_tenant_isolation
      ON owner_contact_prefs
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
