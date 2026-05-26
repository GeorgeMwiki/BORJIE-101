-- =============================================================================
-- Migration 0051 — Ambient Voice Listening (Wave 19J)
--
-- Spec: Docs/DESIGN/AMBIENT_VOICE_LISTENING_SPEC.md
-- Consumed by packages/ambient-listener + services/voice-agent/src/ambient.
--
-- Three tenant-scoped tables backing the ambient-listening pipeline.
-- All RLS-gated by the canonical `current_setting('app.tenant_id', true)` GUC
-- (migration 0003 pattern). All idempotent — IF NOT EXISTS + DO blocks. Safe to
-- re-run.
--
-- Locked default per Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md
-- (Decisions 3 + 4 — privacy tiers + 90-day re-consent + per-employee opt-out).
--
--   1. ambient_consents               — composite (tenant, user, channel) PK.
--                                       consent_state ∈ {granted, revoked,
--                                       not-set}. Drives the silent-disable
--                                       gate on every capture turn.
--   2. ambient_captures               — one row per pipeline capture. Holds
--                                       the redacted text + extracted intent +
--                                       entities jsonb + optional sentiment.
--                                       Hash-chained via prev_hash/audit_hash.
--   3. ambient_kill_switch_events     — append-only kill-switch audit. scope ∈
--                                       {user, org}. Read on every capture
--                                       turn — any row in the last 24 h within
--                                       scope short-circuits the pipeline.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. ambient_consents — composite PK (tenant, user, channel)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ambient_consents (
  tenant_id           text NOT NULL,
  user_id             uuid NOT NULL,
  /** chat | voice_call | sms */
  channel             text NOT NULL,
  /** granted | revoked | not-set */
  consent_state       text NOT NULL DEFAULT 'not-set',
  /** Sentiment-extraction consent is a separate axis (see spec §6). */
  sentiment_consent   boolean NOT NULL DEFAULT false,
  granted_at          timestamptz,
  revoked_at          timestamptz,
  /** UUID of the actor who flipped the row — usually the user themselves. */
  granted_by          uuid,
  audit_hash          text NOT NULL,
  CONSTRAINT ambient_consents_pk PRIMARY KEY (tenant_id, user_id, channel)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ambient_consents_channel_chk'
  ) THEN
    ALTER TABLE ambient_consents
      ADD CONSTRAINT ambient_consents_channel_chk
      CHECK (channel IN ('chat', 'voice_call', 'sms'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ambient_consents_state_chk'
  ) THEN
    ALTER TABLE ambient_consents
      ADD CONSTRAINT ambient_consents_state_chk
      CHECK (consent_state IN ('granted', 'revoked', 'not-set'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_ambient_consents_tenant
  ON ambient_consents (tenant_id);

CREATE INDEX IF NOT EXISTS idx_ambient_consents_tenant_user
  ON ambient_consents (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_ambient_consents_state
  ON ambient_consents (tenant_id, consent_state);

ALTER TABLE ambient_consents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'ambient_consents'
       AND policyname = 'ambient_consents_tenant_isolation'
  ) THEN
    CREATE POLICY ambient_consents_tenant_isolation ON ambient_consents
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. ambient_captures — one row per pipeline capture
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ambient_captures (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text NOT NULL,
  user_id              uuid NOT NULL,
  /** chat | voice_call | sms — same enum as ambient_consents.channel. */
  channel              text NOT NULL,
  /** FK-soft to voice_sessions.id (uuid) or chat_session_id (text). */
  source_session_id    text NOT NULL,
  captured_at          timestamptz NOT NULL DEFAULT now(),
  /** Redacted plaintext — every PII match is replaced with a salted hash
      token of the form `[NIDA_HASH:abc123…]` (see spec §3). */
  redacted_text        text NOT NULL,
  /** Closed ontology — book_inspection | report_incident | query_parcel_status |
      request_meeting | escalate_safety | other. */
  intent               text NOT NULL,
  /** Array of `{kind, value_hash, span}` records — see types.ts EntityHit. */
  entities             jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** Bounded scalar in [-1, 1]; NULL when sentiment_consent is false. */
  sentiment            real,
  audit_hash           text NOT NULL,
  /** Previous row's audit_hash — chained per spec §3. */
  prev_hash            text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ambient_captures_channel_chk'
  ) THEN
    ALTER TABLE ambient_captures
      ADD CONSTRAINT ambient_captures_channel_chk
      CHECK (channel IN ('chat', 'voice_call', 'sms'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ambient_captures_sentiment_range'
  ) THEN
    ALTER TABLE ambient_captures
      ADD CONSTRAINT ambient_captures_sentiment_range
      CHECK (sentiment IS NULL OR (sentiment >= -1 AND sentiment <= 1));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_ambient_captures_tenant_captured
  ON ambient_captures (tenant_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_ambient_captures_tenant_user_captured
  ON ambient_captures (tenant_id, user_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_ambient_captures_tenant_intent
  ON ambient_captures (tenant_id, intent, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_ambient_captures_source_session
  ON ambient_captures (tenant_id, source_session_id);

ALTER TABLE ambient_captures ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'ambient_captures'
       AND policyname = 'ambient_captures_tenant_isolation'
  ) THEN
    CREATE POLICY ambient_captures_tenant_isolation ON ambient_captures
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. ambient_kill_switch_events — append-only kill-switch audit
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ambient_kill_switch_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  /** UUID of the actor who triggered the kill switch. */
  triggered_by    uuid NOT NULL,
  triggered_at    timestamptz NOT NULL DEFAULT now(),
  /** Free-text reason; persisted verbatim for the right-of-access export. */
  reason          text NOT NULL,
  /** user | org — drives the scope of the silent-disable gate. */
  scope           text NOT NULL,
  /** When scope='user', the user_id whose pipeline is killed. NULL for org. */
  target_user_id  uuid,
  audit_hash      text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ambient_kse_scope_chk'
  ) THEN
    ALTER TABLE ambient_kill_switch_events
      ADD CONSTRAINT ambient_kse_scope_chk
      CHECK (scope IN ('user', 'org'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_ambient_kse_tenant_triggered
  ON ambient_kill_switch_events (tenant_id, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_ambient_kse_tenant_scope_triggered
  ON ambient_kill_switch_events (tenant_id, scope, triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_ambient_kse_tenant_target_triggered
  ON ambient_kill_switch_events (tenant_id, target_user_id, triggered_at DESC);

ALTER TABLE ambient_kill_switch_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'ambient_kill_switch_events'
       AND policyname = 'ambient_kse_tenant_isolation'
  ) THEN
    CREATE POLICY ambient_kse_tenant_isolation ON ambient_kill_switch_events
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
