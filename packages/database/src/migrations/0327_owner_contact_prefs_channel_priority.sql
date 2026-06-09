-- =============================================================================
-- Migration 0327 — owner_contact_prefs.channel_priority (ORDERED delivery list).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- owner_contact_prefs (migration 0098) carries ONE frozen `preferred_channel`
-- and NO owner write path — the owner could never express HOW they want to be
-- reached, only a single sticky channel. The reminders-dispatch worker + the
-- chat-created reminder handler therefore had no notion of fallback ORDER: if
-- the single preferred channel had no deliverable destination, the dispatcher
-- guessed (email → sms → slack) rather than honouring the owner's intent.
--
-- This column adds `channel_priority`: an ORDERED jsonb array of channels,
-- highest-priority first (e.g. ["slack", "email", "sms"]). The action-executor
-- + dispatcher walk the list and pick the FIRST channel with a resolvable
-- destination, so the owner's stated ranking drives delivery. `preferred_channel`
-- is kept verbatim for back-compat (the resolver derives an empty default list
-- from it when this column is unset on a legacy row).
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): ADD COLUMN IF NOT EXISTS
-- with a NOT NULL DEFAULT '[]'::jsonb, so existing rows backfill to the empty
-- list (the resolver then falls back to [preferred_channel]) and a re-run is a
-- pure no-op. References only the pre-existing `owner_contact_prefs` table
-- (migration 0098). No backfill hazard — the new column has a constant default,
-- so the NOT-NULL safety validator is satisfied.
--
-- Mirrors the ADD COLUMN shape of migration 0303 (reminders.attempt_count).
--
-- Companion files:
--   * packages/database/src/schemas/owner-contact-prefs.schema.ts
--   * services/api-gateway/src/services/owner-identity/resolver.ts
--   * services/api-gateway/src/services/action-executor/handlers/reminders.ts
--   * services/api-gateway/src/routes/owner/contact-prefs.hono.ts
-- =============================================================================

BEGIN;

ALTER TABLE owner_contact_prefs
  ADD COLUMN IF NOT EXISTS channel_priority jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN owner_contact_prefs.channel_priority IS
  'ORDERED list of dispatch channels, highest-priority first (e.g. '
  '["slack","email","sms"]). The dispatcher / action-executor pick the FIRST '
  'channel with a resolvable destination. Empty list falls back to '
  'preferred_channel. Kept alongside (not replacing) preferred_channel.';

COMMIT;
