-- ─────────────────────────────────────────────────────────────────────
-- Migration 0135 — Implicit feedback signals.
--
-- C5 / Phase A — Progressive Intelligence.
--
-- Explicit feedback (thumbs) is <1% of interactions. RLUF / ICML 2025
-- both show implicit signals (copy, re-prompt, edit-resubmit, override,
-- abandonment, time-to-resolution) carry the bulk of the information.
--
-- Sensorium events (C4) emit raw user interactions; the consolidation
-- worker's stage 01-ingest joins those back to the originating kernel
-- turn via the (trace_id, agent_action_id, tenant_id, user_id, surface,
-- role) tuple and persists one row per signal.
--
-- `strength` is the producer-assigned [0, 1] weight derived from the
-- table in `2025-progressive-intelligence.md`:
--   copy = 0.7, re-prompt = 0.85, edit-resubmit = 0.95, override = 1.0,
--   abandonment = 0.6, time-to-resolution = 0.5.
--
-- Idempotent: CREATE TABLE / INDEX ... IF NOT EXISTS.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS implicit_feedback_signals (
  id                TEXT PRIMARY KEY,
  trace_id          TEXT NOT NULL,
  agent_action_id   TEXT,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL,
  surface           TEXT NOT NULL,
  signal_type       TEXT NOT NULL,
  strength          REAL NOT NULL,
  payload_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  emitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_implicit_feedback_trace
  ON implicit_feedback_signals (trace_id);

CREATE INDEX IF NOT EXISTS idx_implicit_feedback_user_time
  ON implicit_feedback_signals (tenant_id, user_id, emitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_implicit_feedback_type
  ON implicit_feedback_signals (tenant_id, signal_type, emitted_at DESC);

COMMENT ON TABLE implicit_feedback_signals IS
  'C5 implicit user-behaviour signals: copy / re-prompt / edit-resubmit / override / abandonment / time-to-resolution. Joined to traces via the (trace_id, agent_action_id, tenant_id, user_id, surface, role) tuple.';
