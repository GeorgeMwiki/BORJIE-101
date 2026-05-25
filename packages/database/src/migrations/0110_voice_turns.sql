-- =============================================================================
-- 0110: Voice conversational turns (Agent PhL — voice-first tenant/owner agent)
-- =============================================================================
-- Append-only log of voice-mediated conversational turns. Each turn records
-- STT transcript, detected language (ISO-639-1/-2, any language — not just
-- en/sw), the brain's response, any tool calls executed during the turn,
-- and the TTS audio reference.
--
-- The conversation loop is global-first: language detection runs per turn,
-- response is synthesized back in the same detected language. The brain's
-- tool-call output is recorded for audit.
--
-- `degraded_mode` is TRUE when either STT or TTS adapters returned
-- VOICE_NOT_CONFIGURED — the turn still logs for analytics.
-- =============================================================================

CREATE TABLE IF NOT EXISTS voice_turns (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id          TEXT NOT NULL,
  customer_id         TEXT,                                    -- resolved from caller phone/user
  turn_index          INTEGER NOT NULL CHECK (turn_index >= 0),
  detected_language   TEXT,                                    -- ISO-639-1/-2, LLM-detected
  input_audio_ref     TEXT,                                    -- opaque storage URL
  input_transcript    TEXT,                                    -- STT output
  stt_confidence      DOUBLE PRECISION CHECK (stt_confidence IS NULL OR (stt_confidence BETWEEN 0 AND 1)),
  response_text       TEXT,                                    -- brain output (pre-TTS)
  response_audio_ref  TEXT,                                    -- TTS output URL
  tool_calls          JSONB NOT NULL DEFAULT '[]'::jsonb,      -- executed tool calls
  degraded_mode       BOOLEAN NOT NULL DEFAULT FALSE,
  model_version       TEXT,
  prompt_hash         TEXT,
  latency_ms          INTEGER CHECK (latency_ms IS NULL OR latency_ms >= 0),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voice_turns_session
  ON voice_turns (tenant_id, session_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_voice_turns_customer
  ON voice_turns (tenant_id, customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;
