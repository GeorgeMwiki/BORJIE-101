-- ─────────────────────────────────────────────────────────────────────
-- Migration 0138 — platform_killswitch_state (Central Command HQ tools).
--
-- DB-backed override for the kernel killswitch. The kernel's existing
-- `KillswitchPort` (in `kernel/killswitch.ts`) reads from env vars. This
-- table is queried as a HIGHER-PRIORITY source: when a row exists for the
-- matching scope, the adapter publishes a `cross-portal` event so every
-- running brain instance picks up the new state immediately (no restart).
--
-- One row per scope (UNIQUE constraint on `scope`). Writes UPSERT.
--
-- Idempotent: CREATE ... IF NOT EXISTS guards everywhere.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_killswitch_state (
  id                  TEXT PRIMARY KEY,
  scope               TEXT NOT NULL,
  level               TEXT NOT NULL,
  reason_code         TEXT NOT NULL,
  note                TEXT,
  prev_level          TEXT,
  prev_reason_code    TEXT,
  prev_note           TEXT,
  set_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  set_by              TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_killswitch_state_scope
  ON platform_killswitch_state (scope);

CREATE INDEX IF NOT EXISTS idx_platform_killswitch_state_set_at
  ON platform_killswitch_state (set_at);

COMMENT ON TABLE platform_killswitch_state IS
  'DB-backed killswitch override. scope = "platform" | "tenant:<id>". Takes precedence over env-var killswitch when present. Adapter publishes cross-portal event on write so all brains see the new state immediately.';
COMMENT ON COLUMN platform_killswitch_state.level IS
  'One of: live | degraded | halt.';
COMMENT ON COLUMN platform_killswitch_state.prev_level IS
  'Snapshot of the previous level before this flip — required by the HQ-tool rollback contract.';
