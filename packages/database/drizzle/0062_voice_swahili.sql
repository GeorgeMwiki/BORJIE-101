-- =============================================================================
-- Migration 0034 — Voice channel + Swahili gauntlet (Wave 19F)
--
-- Spec: Docs/DESIGN/VOICE_GEMINI_LIVE_SWAHILI_SPEC.md
--
-- Two tables — both backstop the new gemini-live + swahili-gauntlet
-- subdirectories under services/voice-agent/src/. Both are tenant-scoped and
-- use the canonical `current_setting('app.tenant_id', true)` GUC RLS policy
-- from migration 0003.
--
--   1. voice_sessions             — one row per live caller session across
--                                    whatsapp / sms / app / pstn channels.
--                                    Tracks provider, language, p50/p95
--                                    voice-to-voice latency, and the
--                                    demotion history (gemini-live →
--                                    secondary → tertiary).
--   2. swahili_gauntlet_results   — one row per gauntlet utterance run.
--                                    Drives the WER + MOS drift dashboards.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. voice_sessions — one row per caller session
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS voice_sessions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   text NOT NULL,
  /** E.164 phone for WhatsApp/SMS/PSTN; user_id for in-app callers. */
  caller_id                   text NOT NULL,
  /** whatsapp | sms | app | pstn */
  channel                     text NOT NULL,
  /** gemini-live | gpt-realtime-2 | whisper-local | anthropic-eleven */
  provider                    text NOT NULL,
  /** Language tag (sw | sw-TZ | en-KE | sheng | …) — defaults sw. */
  language                    text NOT NULL DEFAULT 'sw',
  started_at                  timestamptz NOT NULL DEFAULT now(),
  ended_at                    timestamptz,
  turn_count                  integer NOT NULL DEFAULT 0,
  voice_to_voice_p50_ms       integer,
  voice_to_voice_p95_ms       integer,
  /** Array of { from, to, reason, at } records — append-only audit trail. */
  demotion_history            jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** Reference to the long-term transcript object store (e.g. s3://…). */
  transcript_archive_ref      text,
  audit_hash                  text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_sessions_channel_chk'
  ) THEN
    ALTER TABLE voice_sessions
      ADD CONSTRAINT voice_sessions_channel_chk
      CHECK (channel IN ('whatsapp', 'sms', 'app', 'pstn'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'voice_sessions_provider_chk'
  ) THEN
    ALTER TABLE voice_sessions
      ADD CONSTRAINT voice_sessions_provider_chk
      CHECK (provider IN (
        'gemini-live',
        'gpt-realtime-2',
        'whisper-local',
        'anthropic-eleven'
      ));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_voice_sessions_tenant_started
  ON voice_sessions (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_tenant_provider_started
  ON voice_sessions (tenant_id, provider, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_caller
  ON voice_sessions (tenant_id, caller_id, started_at DESC);

ALTER TABLE voice_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'voice_sessions'
       AND policyname = 'voice_sessions_tenant_isolation'
  ) THEN
    CREATE POLICY voice_sessions_tenant_isolation ON voice_sessions
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. swahili_gauntlet_results — one row per utterance per gauntlet run
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS swahili_gauntlet_results (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text NOT NULL,
  /** Groups all 50 utterances of one run; RFC 4122. */
  run_id                  uuid NOT NULL,
  provider                text NOT NULL,
  model_version           text NOT NULL,
  /** Foreign key to the `test-utterances.ts` set (e.g. 'reg-001'). */
  utterance_id            text NOT NULL,
  reference_transcript    text NOT NULL,
  hypothesis_transcript   text NOT NULL,
  /** WER as a fraction; numeric(6,4) covers 0.0000 .. 99.9999. */
  wer                     numeric(6, 4) NOT NULL,
  /** Mean opinion score (1.00 .. 5.00); nullable until human raters fill in. */
  mos                     numeric(3, 2),
  latency_ms              integer NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  audit_hash              text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sgr_wer_nonneg'
  ) THEN
    ALTER TABLE swahili_gauntlet_results
      ADD CONSTRAINT sgr_wer_nonneg CHECK (wer >= 0);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sgr_mos_range'
  ) THEN
    ALTER TABLE swahili_gauntlet_results
      ADD CONSTRAINT sgr_mos_range
      CHECK (mos IS NULL OR (mos >= 1.0 AND mos <= 5.0));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_sgr_tenant_run
  ON swahili_gauntlet_results (tenant_id, run_id);

CREATE INDEX IF NOT EXISTS idx_sgr_tenant_provider_created
  ON swahili_gauntlet_results (tenant_id, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sgr_tenant_utterance_created
  ON swahili_gauntlet_results (tenant_id, utterance_id, created_at DESC);

ALTER TABLE swahili_gauntlet_results ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'swahili_gauntlet_results'
       AND policyname = 'sgr_tenant_isolation'
  ) THEN
    CREATE POLICY sgr_tenant_isolation ON swahili_gauntlet_results
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
