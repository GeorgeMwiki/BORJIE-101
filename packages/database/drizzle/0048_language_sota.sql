-- =============================================================================
-- Migration 0048 — Language-SOTA core (Wave 19G)
--
-- Spec: Docs/DESIGN/LANGUAGE_VOICE_SOTA_SPEC.md
--
-- Three tenant-scoped tables back the @borjie/language-sota runtime. All
-- three use the canonical `current_setting('app.tenant_id', true)` GUC RLS
-- policy from migration 0003.
--
--   1. language_utterances         — one row per captured utterance across
--                                     voice / chat / sms / whatsapp channels.
--                                     Carries phonemes + prosody + code-
--                                     switching segments + provider
--                                     attribution + audit hash chain. The
--                                     consent gate enforced by the
--                                     repository writes only rows whose
--                                     subject opted in (per
--                                     FOUNDER_LOCKED_DECISIONS §3 + §4).
--
--   2. language_provider_quality   — periodic (provider, language) quality
--                                     samples (WER, PER, MOS, n). Read by
--                                     the router at request time to pick
--                                     the best-quality provider for the
--                                     desired (capability, language) pair.
--
--   3. language_user_profile       — per-user preferred / secondary language,
--                                     dialect tags, pronunciation profile.
--                                     PK is (tenant_id, user_id). Read by
--                                     the prosody-controller to bias TTS
--                                     output toward the user's baseline.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. language_utterances — one row per captured utterance
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS language_utterances (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL,
  user_id               text NOT NULL,
  /** voice | chat | sms | whatsapp */
  channel               text NOT NULL,
  /** Caller-declared language tag (en | sw | sheng | unknown). */
  source_lang           text NOT NULL,
  /** Detector verdict — may differ from source_lang. */
  detected_lang         text NOT NULL,
  /** The textual content (post-PII-redaction). */
  text                  text NOT NULL,
  /**
   * Phoneme sequence — array of { ipa, start_ms, end_ms, gop } objects.
   * Populated by the MFA-port aligner.
   */
  phonemes              jsonb NOT NULL DEFAULT '[]'::jsonb,
  /**
   * Prosody envelope — { f0_contour: number[], stress_bins: number[],
   * intonation_shape: 'rising' | 'falling' | 'flat' | 'undulating' }.
   */
  prosody               jsonb NOT NULL DEFAULT '{}'::jsonb,
  /**
   * Token-level code-switching segments — array of
   * { start_token: int, end_token: int, lang: text, confidence: float }.
   */
  codeswitch_segments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** Detector confidence in [0, 1]. */
  confidence            real NOT NULL,
  /** Provider that produced the STT transcript (gemini-live | openai | …). */
  provider              text,
  /** Consent state captured at write time (per FOUNDER_LOCKED §3). */
  consent_state         text NOT NULL,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  audit_hash            text NOT NULL,
  /** Genesis row uses sha256('genesis') = e3b0c…b855. */
  prev_hash             text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_utterances_channel_chk'
  ) THEN
    ALTER TABLE language_utterances
      ADD CONSTRAINT language_utterances_channel_chk
      CHECK (channel IN ('voice', 'chat', 'sms', 'whatsapp'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_utterances_consent_chk'
  ) THEN
    ALTER TABLE language_utterances
      ADD CONSTRAINT language_utterances_consent_chk
      CHECK (consent_state IN (
        'subject-opt-in',
        'org-default-learn',
        'single-shot-share',
        'voice-call-prompt'
      ));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_utterances_confidence_chk'
  ) THEN
    ALTER TABLE language_utterances
      ADD CONSTRAINT language_utterances_confidence_chk
      CHECK (confidence >= 0 AND confidence <= 1);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_language_utterances_tenant_recorded
  ON language_utterances (tenant_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_language_utterances_tenant_user_recorded
  ON language_utterances (tenant_id, user_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_language_utterances_tenant_channel
  ON language_utterances (tenant_id, channel, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_language_utterances_tenant_lang
  ON language_utterances (tenant_id, detected_lang, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_language_utterances_audit_hash
  ON language_utterances (audit_hash);

ALTER TABLE language_utterances ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'language_utterances'
       AND policyname = 'language_utterances_tenant_isolation'
  ) THEN
    CREATE POLICY language_utterances_tenant_isolation ON language_utterances
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. language_provider_quality — periodic (provider, language) samples
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS language_provider_quality (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  provider      text NOT NULL,
  lang          text NOT NULL,
  /** Word Error Rate in [0, 1]. */
  wer           real NOT NULL,
  /** Phoneme Error Rate in [0, 1]. */
  per           real NOT NULL,
  /** Mean Opinion Score in [1, 5]. */
  mos           real NOT NULL,
  measured_at   timestamptz NOT NULL DEFAULT now(),
  sample_n      integer NOT NULL,
  audit_hash    text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_provider_quality_wer_chk'
  ) THEN
    ALTER TABLE language_provider_quality
      ADD CONSTRAINT language_provider_quality_wer_chk
      CHECK (wer >= 0 AND wer <= 1);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_provider_quality_per_chk'
  ) THEN
    ALTER TABLE language_provider_quality
      ADD CONSTRAINT language_provider_quality_per_chk
      CHECK (per >= 0 AND per <= 1);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_provider_quality_mos_chk'
  ) THEN
    ALTER TABLE language_provider_quality
      ADD CONSTRAINT language_provider_quality_mos_chk
      CHECK (mos >= 1.0 AND mos <= 5.0);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'language_provider_quality_sample_n_chk'
  ) THEN
    ALTER TABLE language_provider_quality
      ADD CONSTRAINT language_provider_quality_sample_n_chk
      CHECK (sample_n > 0);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_lpq_tenant_provider_lang_measured
  ON language_provider_quality (tenant_id, provider, lang, measured_at DESC);

CREATE INDEX IF NOT EXISTS idx_lpq_tenant_lang_measured
  ON language_provider_quality (tenant_id, lang, measured_at DESC);

ALTER TABLE language_provider_quality ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'language_provider_quality'
       AND policyname = 'language_provider_quality_tenant_isolation'
  ) THEN
    CREATE POLICY language_provider_quality_tenant_isolation ON language_provider_quality
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. language_user_profile — per-user language preference + pronunciation
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS language_user_profile (
  tenant_id              text NOT NULL,
  user_id                text NOT NULL,
  /** Preferred language tag — defaults to 'en'. */
  preferred_lang         text NOT NULL DEFAULT 'en',
  /** Secondary language tag — defaults to 'sw'. */
  secondary_lang         text NOT NULL DEFAULT 'sw',
  /**
   * Per-phoneme baseline — { [ipa]: { gop_mean, gop_std, samples } }.
   * Used by the prosody controller to bias TTS output toward the user.
   */
  pronunciation_profile  jsonb NOT NULL DEFAULT '{}'::jsonb,
  /**
   * Dialect annotations (e.g. ['sw-TZ-coastal', 'sheng-mwanza',
   * 'en-EA']). Free-form text per the design spec.
   */
  dialect_tags           text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_language_user_profile_tenant_preferred
  ON language_user_profile (tenant_id, preferred_lang);

ALTER TABLE language_user_profile ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'language_user_profile'
       AND policyname = 'language_user_profile_tenant_isolation'
  ) THEN
    CREATE POLICY language_user_profile_tenant_isolation ON language_user_profile
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0048_language_sota.sql
-- =============================================================================
