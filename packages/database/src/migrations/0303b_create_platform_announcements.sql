-- =============================================================================
-- Migration 0303b — CREATE platform_announcements (missing-CREATE remediation).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The HQ-tier `platform_announcements` table is defined in the Drizzle schema
-- (packages/database/src/schemas/platform-announcements.schema.ts) and is
-- ALTERed by migration 0304 (adds `fanned_out_at`), but NO migration in the
-- chain ever CREATEd it: both the schema header and 0304's comment cite
-- "migration 0139", which is actually `0139_device_push_tokens.sql`. The
-- original CREATE was lost / never written during the property→mining
-- migration, so a from-scratch apply (and the live DB) reached 0304 with the
-- table absent → 0304 failed with `relation "platform_announcements" does not
-- exist` (42P01). This migration back-fills the missing CREATE.
--
-- ORDERING: named `0303b` so it sorts AFTER `0303_reminders_retry_attempt_count`
-- and BEFORE `0304_announcement_fanout` in the runner's lexical apply order
-- (the runner applies any not-yet-recorded *.sql in lex order — see
-- packages/database/src/run-migrations.ts). No migration between 0140–0303
-- references this table, so creating it here is equivalent to creating it at
-- its originally-intended early position. 0304 (immutable, already shipped) is
-- left untouched; its `ALTER TABLE ... ADD COLUMN IF NOT EXISTS fanned_out_at`
-- runs immediately after this.
--
-- TENANT SCOPE / RLS (CLAUDE.md hard rule): `platform_announcements` is an
-- HQ-tier, NON-tenant-scoped table — it keys broadcast by a `scope` TEXT column
-- ('global' | 'tenant:<id>') and carries no `tenant_id`. The "FORCE RLS on new
-- tenant-scoped tables" rule therefore does not apply (mirrors 0304's note; the
-- per-recipient rows land in the already-RLS-FORCEd `notification_dispatch_log`).
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every statement is
-- IF NOT EXISTS, so a re-run — or an environment where the table was created
-- out-of-band via `drizzle-kit push` — is a pure no-op. Column set mirrors the
-- Drizzle schema EXACTLY, minus `fanned_out_at` (migration 0304 adds it).
--
-- Companion files:
--   * packages/database/src/schemas/platform-announcements.schema.ts
--   * packages/database/src/services/platform/announcement.service.ts
--   * packages/database/src/migrations/0304_announcement_fanout.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS platform_announcements (
  id               text PRIMARY KEY,
  scope            text NOT NULL,
  channel          text NOT NULL,
  subject          text NOT NULL,
  body             text NOT NULL,
  recipient_count  integer NOT NULL DEFAULT 0,
  scheduled_for    timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'queued',
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text NOT NULL,
  retracted_at     timestamptz,
  retracted_reason text
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_scope
  ON platform_announcements (scope);
CREATE INDEX IF NOT EXISTS idx_platform_announcements_status
  ON platform_announcements (status);
CREATE INDEX IF NOT EXISTS idx_platform_announcements_scheduled_for
  ON platform_announcements (scheduled_for);

COMMIT;
