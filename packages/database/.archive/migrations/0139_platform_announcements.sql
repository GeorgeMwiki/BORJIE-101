-- ─────────────────────────────────────────────────────────────────────
-- Migration 0139 — platform_announcements (Central Command HQ tools).
--
-- Backs the `platform.send_announcement` HQ-tier tool (external-comm,
-- four-eye approval required). Lifecycle: queued → sending → sent or
-- retracted. The HQ-tool rollback path flips `status='retracted'` and
-- triggers a retraction follow-up via the existing notification-dispatch.
--
-- Idempotent: CREATE ... IF NOT EXISTS guards everywhere.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_announcements (
  id                  TEXT PRIMARY KEY,
  scope               TEXT NOT NULL,
  channel             TEXT NOT NULL,
  subject             TEXT NOT NULL,
  body                TEXT NOT NULL,
  recipient_count     INTEGER NOT NULL DEFAULT 0,
  scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status              TEXT NOT NULL DEFAULT 'queued',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT NOT NULL,
  retracted_at        TIMESTAMPTZ,
  retracted_reason    TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_scope
  ON platform_announcements (scope);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_status
  ON platform_announcements (status);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_scheduled_for
  ON platform_announcements (scheduled_for);

COMMENT ON TABLE platform_announcements IS
  'HQ-tier broadcast announcements. scope = "global" | "tenant:<id>". status lifecycle: queued → sending → sent → (optional) retracted. Retraction is the rollback contract for external-comm — recall sends a retraction follow-up via notification-dispatch.';
COMMENT ON COLUMN platform_announcements.channel IS
  'One of: banner | email | both.';
COMMENT ON COLUMN platform_announcements.status IS
  'One of: queued | sending | sent | retracted. Set via UPSERT during lifecycle transitions.';
