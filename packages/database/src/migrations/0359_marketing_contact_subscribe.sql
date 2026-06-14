-- =============================================================================
-- Migration 0359 — marketing contact + subscribe inbound persistence (KI-013).
--
-- WHY THIS MIGRATION EXISTS
-- ------------------------
-- The marketing site ships two public lead-capture surfaces whose Next route
-- handlers (apps/marketing/src/app/api/{contact,subscribe}/route.ts) forward
-- server-to-server to the api-gateway:
--   * POST /api/v1/marketing/contact    (name/email/org/kind/message)
--   * POST /api/v1/marketing/subscribe  (email)
-- Those gateway endpoints did not exist, so EVERY submit 404'd back into the
-- handler's `!upstream.ok` branch and the visitor saw `?sent=error` /
-- `?subscribed=error`. This migration is the persistence half of the fix — it
-- mirrors `marketing_pilot_applications` (migration 0146) so inbound contact
-- inquiries and blog subscribers land in durable storage, not just the
-- structured-log fan-out.
--
-- RLS (mirrors marketing_pilot_applications EXACTLY)
-- --------------------------------------------------
-- Public-write surface: the prospect has no tenant yet, so INSERT is unbound
-- (`WITH CHECK (true)`) and there is NO tenant_id column / tenant scoping.
-- Reads + updates require a SUPER_ADMIN context
-- (`current_setting('app.is_super_admin', true) = 'true'`), gated in app code
-- by `requireRole`. FORCE ROW LEVEL SECURITY is enabled so even the table
-- owner is subject to the policies. The anon role is REVOKE'd defence-in-depth.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): tables are CREATE TABLE
-- IF NOT EXISTS; every policy is pg_policies-guarded; FORCE ROW LEVEL SECURITY
-- is asserted, never dropped; the anon REVOKE is role-guarded. Pure additive
-- DDL — no data touched, no NOT-NULL backfill / lock hazard. Re-apply on a
-- fully-migrated DB is a no-op. Immutable once shipped — never edit; append.
--
-- Companion files:
--   * services/api-gateway/src/routes/marketing.hono.ts (POST /contact, /subscribe)
--   * packages/database/src/schemas/marketing-contact-submissions.schema.ts
--   * packages/database/src/schemas/marketing-subscriptions.schema.ts
--   * packages/database/src/migrations/0146_marketing_pilot_applications.sql (the pattern)
--   * packages/database/src/migrations/down/0359_down_marketing_contact_subscribe.sql
-- =============================================================================

BEGIN;

-- ── marketing_contact_submissions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_contact_submissions (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  org             TEXT NOT NULL DEFAULT '',
  kind            TEXT NOT NULL DEFAULT 'general',
  message         TEXT NOT NULL,
  source_ip       TEXT,
  user_agent      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_contact_submissions_created_at
  ON marketing_contact_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_contact_submissions_email
  ON marketing_contact_submissions (lower(email));

-- ── marketing_subscriptions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketing_subscriptions (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  source_ip       TEXT,
  user_agent      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  unsubscribed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_subscriptions_created_at
  ON marketing_subscriptions (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_subscriptions_email
  ON marketing_subscriptions (lower(email));

-- ── RLS (mirror marketing_pilot_applications) ──────────────────────────────
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'marketing_contact_submissions',
    'marketing_subscriptions'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Only act when the table exists on this DB (fresh-DB guard).
    IF to_regclass('public.' || quote_ident(tbl)) IS NULL THEN
      RAISE NOTICE '% absent — skipping RLS (fresh-DB guard)', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    -- Public-write (no tenant binding) — the marketing site POSTs without a
    -- session, exactly like marketing_pilot_applications' pilot_app_insert.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_insert'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (true);',
        tbl || '_insert', tbl
      );
    END IF;

    -- Reads require SUPER_ADMIN context (admin-web list pages via requireRole).
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_select_super_admin'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT '
        || 'USING (current_setting(''app.is_super_admin'', true) = ''true'');',
        tbl || '_select_super_admin', tbl
      );
    END IF;

    -- Updates (acknowledge / unsubscribe) require SUPER_ADMIN context.
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_update_super_admin'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR UPDATE '
        || 'USING (current_setting(''app.is_super_admin'', true) = ''true'') '
        || 'WITH CHECK (current_setting(''app.is_super_admin'', true) = ''true'');',
        tbl || '_update_super_admin', tbl
      );
    END IF;

    -- Defence-in-depth: the anon role should never reach these tables.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
