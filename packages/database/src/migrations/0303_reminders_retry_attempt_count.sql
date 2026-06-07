-- =============================================================================
-- Migration 0303 — reminders.attempt_count (durable retry for owner reminders).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The reminders-dispatch worker
-- (services/api-gateway/src/workers/reminders-dispatch.worker.ts) polls
-- `reminders` where `status='scheduled' AND trigger_at <= now()`, dispatches
-- via the email/SMS/Slack providers, and on ANY provider error flipped the row
-- to `status='failed'` — permanently. A single transient failure (provider
-- 429 / 5xx / network timeout) therefore meant the owner NEVER received that
-- rent/royalty/renewal reminder: it failed silently and was never retried.
--
-- This column lets the worker bound retries the same way the notification-
-- dispatch worker already does (MAX_ATTEMPTS=5, exponential backoff): on a
-- RETRYABLE failure it re-queues the row (status back to 'scheduled',
-- trigger_at = now + backoff) and bumps attempt_count; once attempt_count
-- reaches the cap (or the failure is non-retryable, e.g. no address on file)
-- it lands in a terminal 'failed'. The existing `trigger_at <= now()` claim is
-- reused verbatim as the retry schedule — no new index or claim change.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): ADD COLUMN IF NOT
-- EXISTS with a NOT NULL DEFAULT 0, so existing rows backfill to 0 and a
-- re-run is a pure no-op. References only the pre-existing `reminders` table
-- (migration 0089).
--
-- Companion files:
--   * packages/database/src/schemas/owner-reminders.schema.ts
--   * services/api-gateway/src/workers/reminders-dispatch.worker.ts
-- =============================================================================

BEGIN;

ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

COMMIT;
