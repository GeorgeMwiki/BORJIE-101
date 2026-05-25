-- ─────────────────────────────────────────────────────────────────────
-- Migration 0134 — Reflexion buffer.
--
-- C5 / Phase A — Progressive Intelligence.
--
-- Reflexion (Shinn et al., NeurIPS 2023): at session end the kernel
-- writes a short verbal reflection so the NEXT session for the same
-- (tenant, user) can read it and avoid repeating the same mistake.
-- Pure prompt-layer memory — never touches model weights.
-- +22% on AlfWorld / +20% on HotPotQA / +11% on HumanEval.
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reflexion_buffer (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  reflection      TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retrieved_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reflexion_per_user
  ON reflexion_buffer (tenant_id, user_id, recorded_at DESC);

COMMENT ON TABLE reflexion_buffer IS
  'Reflexion verbal-RL pattern. Written at session end, read at session start. Pure prompt-layer.';
COMMENT ON COLUMN reflexion_buffer.outcome IS
  '''success'' | ''failure'' | ''mixed''';
