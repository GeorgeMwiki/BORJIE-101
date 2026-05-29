-- =============================================================================
-- Migration 0119 — Draft Revisions Provenance Catch-up
--
-- Wave LAUNCH-READINESS-GREEN. Fixes a real ordering artifact in the live
-- dev Postgres: when 0101 (universal provenance) first ran, the
-- `draft_revisions` table did not yet exist on that environment, so
-- the loop's `IF EXISTS … table_name = 'draft_revisions'` branch
-- silently no-op'd. Every other 0101 table received the column
-- correctly. `draft_revisions` was then created by 0100 (re-run /
-- repair) and remained the only laggard.
--
-- This migration is the surgical catch-up: add the column with the
-- same shape, backfill rows still on the `unknown` default, and
-- create the GIN index. 100% forward-only and idempotent (every
-- step uses IF NOT EXISTS or guards on the existing default).
--
-- The /v1/owner/brief 500 ("column \"provenance\" does not exist")
-- documented in `Docs/AUDIT/LAUNCH_READINESS_GREEN.md §6 row 1`
-- closes on apply.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'draft_revisions'
  ) THEN
    ALTER TABLE draft_revisions
      ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{"via":"unknown"}'::jsonb;

    -- Backfill rows still on the default `{"via":"unknown"}` using created_at.
    UPDATE draft_revisions
       SET provenance = jsonb_build_object(
         'via',         'legacy',
         'actorId',     NULL,
         'sessionId',   NULL,
         'requestedAt', to_char(coalesce(created_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
       )
     WHERE provenance ->> 'via' = 'unknown';

    -- GIN index matches the shape 0101 created on every other table.
    CREATE INDEX IF NOT EXISTS draft_revisions_provenance_gin
      ON draft_revisions USING gin (provenance);
  END IF;
END$$;

COMMIT;
