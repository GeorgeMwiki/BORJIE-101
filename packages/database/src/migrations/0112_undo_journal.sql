-- =============================================================================
-- Migration 0112 - Undo Journal (Wave SUPERPOWERS)
--
-- Companion to:
--   - services/api-gateway/src/routes/owner/undo-journal.hono.ts
--   - services/api-gateway/src/composition/brain-tools/superpowers-tools.ts
--   - apps/owner-web/src/components/home-chat/HomeChatTeach.tsx
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Generic undo ledger. Every WRITE brain tool appends one row here so
-- the owner gets a 5-minute "Undo (4:58)" chip on every chat-initiated
-- write. Reads `before_state` / `after_state` JSON snapshots; the
-- undo handler replays `before_state` back into the original table.
--
-- IMPORTANT: this is NOT a replacement for the immutable AI audit
-- chain - it's a transient operational journal. The audit chain still
-- records the WRITE; this table records enough state to reverse it.
-- Rows older than the configured window (default 5 min) are
-- soft-archived by a cron sweeper and surface only in the audit view.
--
-- Tenant-scoped via the canonical `app.tenant_id` GUC RLS predicate.
-- RLS is FORCE-enabled per the Borjie hard rule (CLAUDE.md).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" - never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS undo_journal (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  actor_id        text        NOT NULL,
  /** Entity kind the action targeted, e.g. 'reminder', 'draft',
   *  'pinned_item', 'share_link'. */
  entity_type     text        NOT NULL,
  entity_id       text        NOT NULL,
  /** Action verb, e.g. 'create', 'update', 'delete', 'snooze',
   *  'archive'. Used to pick the inverse handler. */
  action_kind     text        NOT NULL,
  /** Brain-tool id (or 'ui' for direct-UI writes) that produced the
   *  write. Lets the FE thread the undo chip back to the chat bubble. */
  tool_id         text,
  /** Snapshot of the entity row BEFORE the write. NULL when action_kind
   *  is 'create' (nothing to restore - undo deletes the new row). */
  before_state    jsonb,
  /** Snapshot AFTER the write. NULL when action_kind is 'delete'. */
  after_state     jsonb,
  /** Window (seconds) during which the action can be undone. Default
   *  5 min; tools may override (e.g. 60s for trivial writes, 0 for
   *  irreversibles which never log here). */
  window_seconds  integer     NOT NULL DEFAULT 300,
  performed_at    timestamptz NOT NULL DEFAULT now(),
  undone_at       timestamptz,
  undone_by_id    text,
  /** Optional reason recorded when undo fires (e.g. "user clicked Undo
   *  chip", "admin force-reversed"). */
  undo_reason     text,
  /** Universal provenance envelope (chat session, turn, persona slug). */
  provenance      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'undo_journal_action_chk'
  ) THEN
    ALTER TABLE undo_journal
      ADD CONSTRAINT undo_journal_action_chk
      CHECK (action_kind IN (
        'create', 'update', 'delete',
        'snooze', 'archive', 'acknowledge', 'complete', 'withdraw',
        'pin', 'unpin', 'share', 'revoke_share',
        'prefill', 'bulk_update'
      ));
  END IF;
END $$;

-- Hot path: "what can I undo right now?" - actor + recent + un-undone.
CREATE INDEX IF NOT EXISTS undo_journal_actor_recent_idx
  ON undo_journal (tenant_id, actor_id, performed_at DESC)
  WHERE undone_at IS NULL;

-- Hot path: entity-scoped undo (e.g. "undo my last action on this draft").
CREATE INDEX IF NOT EXISTS undo_journal_entity_recent_idx
  ON undo_journal (tenant_id, entity_type, entity_id, performed_at DESC)
  WHERE undone_at IS NULL;

-- Hot path: cron sweeper drops past-window rows from the active index.
CREATE INDEX IF NOT EXISTS undo_journal_window_idx
  ON undo_journal (tenant_id, performed_at)
  WHERE undone_at IS NULL;

ALTER TABLE undo_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE undo_journal FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'undo_journal'
       AND policyname = 'undo_journal_tenant_isolation'
  ) THEN
    CREATE POLICY undo_journal_tenant_isolation
      ON undo_journal
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
