-- =============================================================================
-- Migration 0036 — Tab as Loop (Wave M5)
--
-- Spec: Docs/DESIGN/TAB_AS_LOOP_SPEC.md §12-19
--
-- Persists the server-anchored tab session: every open tab is a
-- long-running loop with state, a delta event stream, and a hashed
-- audit trail. Closing a tab pauses the loop; reopening — even on a
-- different device — rehydrates from the last committed snapshot.
--
-- Two tables:
--   1. tab_sessions  — one row per (user, tab_kind, scope).
--                       Canonical state in jsonb; lifecycle timestamps;
--                       hash-chained for tamper evidence.
--   2. tab_events    — one row per applied client→server delta.
--                       FK to tab_sessions; replayed on hydrate.
--
-- Both tables are tenant-scoped and use the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern from
-- migration 0003.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. tab_sessions — server-anchored persistent tabs
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tab_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  user_id         text NOT NULL,
  tab_kind        text NOT NULL,
  state           jsonb NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'opening',
  opened_at       timestamptz NOT NULL DEFAULT now(),
  paused_at       timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT now() + INTERVAL '7 days',
  audit_hash      text NOT NULL,
  prev_hash       text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tab_sessions_kind_chk'
  ) THEN
    ALTER TABLE tab_sessions
      ADD CONSTRAINT tab_sessions_kind_chk
      CHECK (tab_kind IN (
        'composer', 'workflow', 'dashboard', 'insight',
        'admin', 'owner', 'worker', 'customer'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tab_sessions_lifecycle_chk'
  ) THEN
    ALTER TABLE tab_sessions
      ADD CONSTRAINT tab_sessions_lifecycle_chk
      CHECK (lifecycle_state IN (
        'opening', 'hydrating', 'active', 'paused', 'expiring', 'closed'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tab_sessions_user
  ON tab_sessions (tenant_id, user_id, lifecycle_state);

CREATE INDEX IF NOT EXISTS idx_tab_sessions_active
  ON tab_sessions (tenant_id, lifecycle_state, opened_at DESC)
  WHERE lifecycle_state IN ('active', 'paused');

CREATE INDEX IF NOT EXISTS idx_tab_sessions_expiring
  ON tab_sessions (tenant_id, expires_at)
  WHERE lifecycle_state IN ('paused', 'expiring');

CREATE INDEX IF NOT EXISTS idx_tab_sessions_kind
  ON tab_sessions (tenant_id, tab_kind, opened_at DESC);

ALTER TABLE tab_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tab_sessions_tenant_read ON tab_sessions;
CREATE POLICY tab_sessions_tenant_read ON tab_sessions
  USING (tenant_id = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 2. tab_events — per-delta event log
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tab_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_session_id    uuid NOT NULL REFERENCES tab_sessions(id) ON DELETE CASCADE,
  tenant_id         text NOT NULL,
  event_kind        text NOT NULL,
  iteration         bigint NOT NULL,
  payload           jsonb NOT NULL,
  recorded_at       timestamptz NOT NULL DEFAULT now(),
  audit_hash        text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tab_events_kind_chk'
  ) THEN
    ALTER TABLE tab_events
      ADD CONSTRAINT tab_events_kind_chk
      CHECK (event_kind IN (
        'ui.field-edit',
        'loop.iteration-done',
        'hint.acknowledge',
        'friction.sample',
        'recipe.proposal',
        'lifecycle.transition'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tab_events_session
  ON tab_events (tab_session_id, iteration);

CREATE INDEX IF NOT EXISTS idx_tab_events_tenant_recent
  ON tab_events (tenant_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_tab_events_kind
  ON tab_events (tenant_id, event_kind, recorded_at DESC);

ALTER TABLE tab_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tab_events_tenant_read ON tab_events;
CREATE POLICY tab_events_tenant_read ON tab_events
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
