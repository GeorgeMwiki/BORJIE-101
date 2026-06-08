-- =============================================================================
-- Migration 0304 — platform_announcements.fanned_out_at
--                   (durable email/SMS broadcast fan-out marker).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Operator ANNOUNCEMENTS (the HQ `platform.send_announcement` tool — see
-- packages/database/src/services/platform/announcement.service.ts) today only
-- fan out via SSE / the in-app banner: the notification-dispatcher-adapter
-- (services/api-gateway/src/composition/notification-dispatcher-adapter.ts)
-- publishes onto the cross-portal bus but EXPLICITLY does NOT insert the
-- per-recipient `notification_dispatch_log` rows that the existing
-- dispatcher-worker
-- (services/api-gateway/src/services/notification-dispatch/dispatcher-worker.ts)
-- drains to actually send email/SMS. That per-recipient expansion was deferred
-- to "a future broadcast-fanout worker".
--
-- The new worker
-- (services/api-gateway/src/workers/announcement-fanout.worker.ts) closes that
-- gap: each tick it finds announcements whose channel includes email/SMS and
-- that have not yet been fanned out, resolves the eligible recipients, and
-- INSERTs one `pending` `notification_dispatch_log` row per (recipient,
-- channel). This column is the worker's atomic per-announcement claim marker:
-- a freshly enqueued announcement is stamped `fanned_out_at = now()` in the
-- SAME query that claims it (UPDATE ... WHERE fanned_out_at IS NULL RETURNING),
-- so a second tick / a second replica can never re-expand the same row. The
-- per-row UNIQUE (tenant_id, idempotency_key) on `notification_dispatch_log`
-- (idempotency_key = 'announcement::<announcementId>::<userId>::<channel>') is
-- the second, belt-and-braces idempotency layer.
--
-- TENANT SCOPE / RLS (CLAUDE.md hard rule):
--   `platform_announcements` is an HQ-tier, NON-tenant-scoped table — it keys
--   fan-out by a `scope` TEXT column ('global' | 'tenant:<id>') and has NEVER
--   carried a `tenant_id` column or an RLS policy (migration 0139). This
--   migration ONLY appends a nullable timestamp column to that existing table;
--   it introduces no new tenant-scoped table, so the "FORCE RLS on new tenant
--   tables" rule does not apply here. (The per-recipient rows the worker writes
--   land in `notification_dispatch_log`, which is already tenant-scoped + RLS
--   FORCE-enabled and is stamped with each recipient's `tenant_id`.)
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): ADD COLUMN IF NOT
-- EXISTS with no default leaves existing rows NULL (== "not yet fanned out"),
-- which is exactly the marker the worker treats as claimable. A partial index
-- (CREATE INDEX IF NOT EXISTS ... WHERE fanned_out_at IS NULL) keeps the
-- worker's claim scan cheap. A re-run is a pure no-op. References only the
-- pre-existing `platform_announcements` table (migration 0139).
--
-- Companion files:
--   * packages/database/src/schemas/platform-announcements.schema.ts
--   * services/api-gateway/src/workers/announcement-fanout.worker.ts
-- =============================================================================

BEGIN;

ALTER TABLE platform_announcements
  ADD COLUMN IF NOT EXISTS fanned_out_at timestamptz;

-- Worker claim scan: "announcements not yet fanned out". Partial index keeps
-- the predicate index-only as the table grows (sent rows accumulate).
CREATE INDEX IF NOT EXISTS idx_platform_announcements_fanout_pending
  ON platform_announcements (scheduled_for)
  WHERE fanned_out_at IS NULL;

COMMIT;
