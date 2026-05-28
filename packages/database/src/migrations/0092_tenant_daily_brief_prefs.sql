-- =============================================================================
-- Migration 0092 — Tenant Daily Brief Preferences + Dispatch Ledger
--
-- Companion to:
--   - services/api-gateway/src/workers/daily-brief-cron.ts
--   - services/api-gateway/src/routes/owner/brief.hono.ts
--   - services/api-gateway/src/routes/owner/daily-brief.hono.ts
--   - services/api-gateway/src/routes/mining/internal/daily-brief-overview.hono.ts
--   - apps/owner-web/src/components/dashboard/DailyBriefCard.tsx
--   - apps/admin-web/src/components/dashboard/AdminDailyBriefCard.tsx
--   - packages/database/src/migrations/0079_owner_brief_snapshots.sql
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- WHAT
--   1. Adds three preference columns to `tenants` so each tenant can
--      pick:
--        - `daily_brief_cadence`   — schedule selector (default
--          'daily_06:00_tz' = 06:00 in Africa/Dar_es_Salaam).
--        - `daily_brief_channels`  — array of dispatch channels
--          (email default; sms / slack opt-in).
--        - `daily_brief_recipients` — JSON list of recipients:
--          `[{userId, email, phone, slackHandle}, ...]`.
--
--   2. Creates `daily_brief_dispatches` — append-only idempotency
--      ledger. UNIQUE(tenant_id, snapshot_date, channel, recipient)
--      blocks duplicate sends across cron ticks, restarts, and the
--      manual-trigger endpoint.
--
--   3. Widens the `owner_brief_snapshots.source` CHECK to admit a third
--      provenance value, `daily_cron`, so the rebuilt daily-brief cron
--      can tag its snapshots distinctly from the legacy 06:00 EAT
--      consolidation cron (which still uses 'cron').
--
-- WHY
--   The legacy `executive-brief-cron` was disabled in
--   `services/api-gateway/src/index.ts` because it referenced tables
--   from the BossNyumba hard-fork that no longer exist. The mining-
--   domain rebuild needs per-tenant scheduling + idempotent fan-out
--   without re-introducing the deleted briefing_subscriptions surface.
--
-- INVARIANTS
--   - RLS FORCE-enabled (CLAUDE.md hard rule: every tenant-scoped table).
--   - Canonical `current_setting('app.tenant_id', true)` GUC policy.
--   - Idempotent IF NOT EXISTS guards — safe to re-run.
--   - Forward-only. Immutable per CLAUDE.md.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- tenants — daily-brief preference columns
-- -----------------------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS daily_brief_cadence text
    NOT NULL DEFAULT 'daily_06:00_tz';

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS daily_brief_channels text[]
    NOT NULL DEFAULT ARRAY['email']::text[];

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS daily_brief_recipients jsonb
    NOT NULL DEFAULT '[]'::jsonb;

-- Cadence shape guard: must be either 'off' or a 'daily_HH:MM_tz' token.
-- The cron parses HH:MM via a regex; the constraint keeps stray values
-- out so an operator can never set a malformed cadence in the admin UI.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_daily_brief_cadence_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_daily_brief_cadence_chk
      CHECK (
        daily_brief_cadence = 'off'
        OR daily_brief_cadence ~ '^daily_[0-2][0-9]:[0-5][0-9]_tz$'
      );
  END IF;
END $$;

-- Channels guard: every element must be one of email / sms / slack.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_daily_brief_channels_chk'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_daily_brief_channels_chk
      CHECK (
        daily_brief_channels <@ ARRAY['email','sms','slack']::text[]
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- daily_brief_dispatches — append-only idempotency ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS daily_brief_dispatches (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  snapshot_date         date        NOT NULL,
  channel               text        NOT NULL,
  recipient             text        NOT NULL,
  dispatched_at         timestamptz NOT NULL DEFAULT now(),
  provider_message_id   text,
  status                text        NOT NULL DEFAULT 'sent',
  error_code            text,
  error_message         text,
  hash_chain_id         uuid
);

-- Idempotency: one row per (tenant, day, channel, recipient). The cron
-- inserts with ON CONFLICT DO NOTHING so a duplicate tick is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'dbd_uniq_tenant_date_channel_recipient'
  ) THEN
    ALTER TABLE daily_brief_dispatches
      ADD CONSTRAINT dbd_uniq_tenant_date_channel_recipient
      UNIQUE (tenant_id, snapshot_date, channel, recipient);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dbd_channel_chk'
  ) THEN
    ALTER TABLE daily_brief_dispatches
      ADD CONSTRAINT dbd_channel_chk
      CHECK (channel IN ('email','sms','slack'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dbd_status_chk'
  ) THEN
    ALTER TABLE daily_brief_dispatches
      ADD CONSTRAINT dbd_status_chk
      CHECK (status IN ('sent','failed','skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dbd_tenant_date_desc
  ON daily_brief_dispatches (tenant_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_dbd_status
  ON daily_brief_dispatches (status)
  WHERE status <> 'sent';

CREATE INDEX IF NOT EXISTS idx_dbd_hash_chain
  ON daily_brief_dispatches (hash_chain_id)
  WHERE hash_chain_id IS NOT NULL;

-- RLS — FORCE enabled per CLAUDE.md hard rule.
ALTER TABLE daily_brief_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_brief_dispatches FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'daily_brief_dispatches'
       AND policyname = 'dbd_tenant_isolation'
  ) THEN
    CREATE POLICY dbd_tenant_isolation
      ON daily_brief_dispatches
      FOR ALL
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- owner_brief_snapshots.source — widen CHECK to accept 'daily_cron'
--
-- Migration 0079 created the table with a CHECK enforcing source IN
-- ('cron', 'on-demand'). The new daily-brief cron tags its snapshots
-- with 'daily_cron' so the operator can distinguish the rebuilt cron
-- from the legacy 06:00 EAT consolidation cron (which still uses 'cron').
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'obs_source_chk'
  ) THEN
    ALTER TABLE owner_brief_snapshots DROP CONSTRAINT obs_source_chk;
  END IF;
  ALTER TABLE owner_brief_snapshots
    ADD CONSTRAINT obs_source_chk
    CHECK (source IN ('cron', 'on-demand', 'daily_cron'));
END $$;

COMMIT;
