-- ─────────────────────────────────────────────────────────────────────
-- Migration 0132 — Sensorium event log.
--
-- Central Command Phase A — C4 Sensorium / Brain Skin.
--
-- One row per filtered sensory event emitted by the client-side
-- sensory bus (14-event taxonomy per `.planning/central-command/
-- 00-architecture.md`). Powers the server-side `BehaviorObserver`
-- aggregation (rolling-window signals: engagement.high, frustration.
-- detected, task.completed-without-AI) and downstream LLM context
-- assembly for the brain's mind-state inference.
--
-- Hard guardrails embedded in the surface that writes to this table:
--   - mouse.move events are NEVER persisted (session-replay only)
--   - input.change values are NEVER persisted (only length + hasPii)
--   - keystroke-level events are NEVER persisted (too noisy)
--   - scroll.depth only at 25/50/75/100% milestones
--   - PII redactor (apps/admin-platform-portal/.../pii-redactor.ts)
--     strips values BEFORE payload_json is serialised.
--
-- payload_json is JSONB so we can index per-event-type fields later
-- without a schema migration. Today we keep ad-hoc indices small.
--
-- Append-only by convention. No UPDATE / DELETE path. Tenant cascade
-- so GDPR right-to-be-forgotten over a tenant purges the bus log.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sensorium_event_log (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  surface         TEXT NOT NULL,
  route           TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  emitted_at      TIMESTAMPTZ NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensorium_tenant_user_session
  ON sensorium_event_log (tenant_id, user_id, session_id, emitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensorium_event_type
  ON sensorium_event_log (event_type);

COMMENT ON TABLE sensorium_event_log IS
  'Append-only log of filtered client-side sensory events (14-event taxonomy). Mouse-move + input values NEVER stored — PII-redacted at emit time.';

COMMENT ON COLUMN sensorium_event_log.event_type IS
  'One of: page.view | page.leave | element.click | input.change | form.submit | scroll.depth | dwell.time | focus.change | keyboard.shortcut | copy.paste | viewport.resize | network.request | error.boundary | a11y.tree.diff';

COMMENT ON COLUMN sensorium_event_log.payload_json IS
  'Event-type-specific payload. PII fields (raw input values, selection text, password content) are stripped at the client by pii-redactor.ts BEFORE the batch is POSTed to /api/v1/sensorium/events.';
