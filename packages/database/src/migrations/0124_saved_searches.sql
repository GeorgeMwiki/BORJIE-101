-- =============================================================================
-- Migration 0124 — saved_searches
--
-- Companion to:
--   - packages/database/src/schemas/saved-searches.schema.ts
--   - services/api-gateway/src/routes/owner/saved-searches.hono.ts
--   - services/api-gateway/src/workers/saved-search-worker.ts
--
-- Roadmap R2 — Saved-search alerts. One row per tenant + user + saved
-- search definition. The worker scans rows by `frequency` cadence
-- (hourly | daily | weekly), re-runs the materialised `query_json`
-- against the relevant corpus (marketplace listings, opportunity
-- scanner, regulatory deadlines, etc.) and writes an alert on each
-- *new* match. `last_match_count` is the running watermark so the
-- worker only fires on the delta.
--
-- Tenant scope: tenant_id::text = current_setting('app.current_tenant_id', true)
-- RLS FORCE-enabled per CLAUDE.md hard rule. Idempotent. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS saved_searches (
  id                   text         PRIMARY KEY,
  tenant_id            text         NOT NULL,
  user_id              text         NOT NULL,
  /** Human-readable label rendered in the owner-web list. */
  label                text         NOT NULL,
  /** Free-form JSON describing the query (commodity, geo, price range
   *  + optional sort/limit). Validated at the API layer by zod. */
  query_json           jsonb        NOT NULL DEFAULT '{}'::jsonb,
  /** hourly | daily | weekly. */
  frequency            text         NOT NULL DEFAULT 'daily',
  /** Which corpus to search — marketplace | opportunities | regulatory.
   *  Validated at API layer (no hard CHECK so additional sources can
   *  be added without a migration). */
  source               text         NOT NULL DEFAULT 'marketplace',
  last_run_at          timestamptz,
  last_match_count     integer      NOT NULL DEFAULT 0,
  last_alert_at        timestamptz,
  /** Soft-delete; row stays for audit but the worker skips it. */
  disabled_at          timestamptz,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'saved_searches_frequency_chk'
  ) THEN
    ALTER TABLE saved_searches
      ADD CONSTRAINT saved_searches_frequency_chk
      CHECK (frequency IN ('hourly', 'daily', 'weekly'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS saved_searches_tenant_idx
  ON saved_searches (tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS saved_searches_due_idx
  ON saved_searches (frequency, last_run_at)
  WHERE disabled_at IS NULL;

ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'saved_searches'
       AND policyname = 'saved_searches_tenant_isolation'
  ) THEN
    CREATE POLICY saved_searches_tenant_isolation
      ON saved_searches
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
