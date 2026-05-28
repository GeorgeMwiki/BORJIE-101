-- =============================================================================
-- Migration 0089 — Owner OS Reminders + Dynamic Tabs (Wave OWNER-OS)
--
-- Companion to:
--   - services/api-gateway/src/routes/owner/reminders.hono.ts
--   - services/api-gateway/src/routes/owner/tabs.hono.ts
--   - services/api-gateway/src/workers/reminders-dispatch.worker.ts
--   - apps/owner-web/src/lib/owner-tabs-store.ts
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Two new tenant-scoped tables for the "talk to Mr. Mwikila as your
-- operating system" capability:
--
--   1. reminders — owner-scheduled events that fire by email (default),
--      SMS, or Slack. The reminders-dispatch worker polls
--      `trigger_at <= now() AND status='scheduled'` every 30s,
--      dispatches via the existing notifications-service providers,
--      flips status to 'sent' (or 'failed' on provider error), and
--      records the dispatched_at + dispatch_error. idempotency_key is
--      required so retries (worker restart, partial failure) never
--      double-fire.
--
--   2. owner_tabs — per-user dashboard tab strip state. Stored as a
--      single jsonb document so the FE zustand store can hydrate +
--      persist in one round-trip. RLS forces (tenant_id, user_id) match.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern. RLS is FORCE-enabled per the Borjie hard rule
-- (`CLAUDE.md`).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) reminders — owner-scheduled events with multi-channel dispatch.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS reminders (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text        NOT NULL,
  /** Supabase user id of the owner who created the reminder. */
  owner_id          text        NOT NULL,
  /** Short title that will become the email subject / SMS prefix. */
  title             text        NOT NULL,
  /** Long-form body — markdown allowed; the dispatcher renders to HTML
   *  for email and to plain text for SMS / Slack. */
  body              text        NOT NULL,
  /** Wall-clock time at which the dispatcher should fire the reminder. */
  trigger_at        timestamptz NOT NULL,
  /** Delivery channel chosen at creation. email is the default. */
  channel           text        NOT NULL DEFAULT 'email',
  /** Lifecycle: scheduled → sent | failed | cancelled. */
  status            text        NOT NULL DEFAULT 'scheduled',
  /** Free-form structured context (e.g. document_id, draft_id, deep link). */
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** REQUIRED. Worker dispatches at most once per (tenant_id, idempotency_key)
   *  pair so a restart / partial failure cannot double-fire. */
  idempotency_key   text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  dispatched_at     timestamptz,
  dispatch_error    text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reminders_channel_chk'
  ) THEN
    ALTER TABLE reminders
      ADD CONSTRAINT reminders_channel_chk
      CHECK (channel IN ('email', 'sms', 'slack'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reminders_status_chk'
  ) THEN
    ALTER TABLE reminders
      ADD CONSTRAINT reminders_status_chk
      CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'reminders_idem_uniq'
  ) THEN
    ALTER TABLE reminders
      ADD CONSTRAINT reminders_idem_uniq
      UNIQUE (tenant_id, idempotency_key);
  END IF;
END $$;

-- Worker poll path: scheduled rows whose trigger_at has passed.
-- Partial index keeps the index tiny under steady-state load.
CREATE INDEX IF NOT EXISTS idx_reminders_dispatch_queue
  ON reminders (trigger_at)
  WHERE status = 'scheduled';

-- Owner inbox path: per-tenant, per-owner, newest first.
CREATE INDEX IF NOT EXISTS idx_reminders_owner_created
  ON reminders (tenant_id, owner_id, created_at DESC);

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'reminders'
       AND policyname = 'reminders_tenant_isolation'
  ) THEN
    CREATE POLICY reminders_tenant_isolation
      ON reminders
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) owner_tabs — per-user dashboard tab strip state.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_tabs (
  tenant_id   text        NOT NULL,
  /** Supabase user id of the owner whose tab layout this row describes. */
  user_id     text        NOT NULL,
  /** Free-form jsonb shape — the FE owns the schema. Persisted verbatim
   *  so the FE store can hydrate in one round-trip. */
  state       jsonb       NOT NULL DEFAULT '{"tabs":[],"activeTabId":null}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

ALTER TABLE owner_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_tabs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_tabs'
       AND policyname = 'owner_tabs_tenant_isolation'
  ) THEN
    CREATE POLICY owner_tabs_tenant_isolation
      ON owner_tabs
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
