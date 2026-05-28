-- =============================================================================
-- Migration 0107 - Owner-to-owner messaging.
--
-- Wave OWNER-MESSAGING. Direct messaging between owners (looked up via
-- NIDA / TIN / BRELA registration number). Powers the owner-web /inbox
-- screen and the chat brain tools (`owner.messaging.send_to`,
-- `unread_count`, `thread_list`).
--
-- Tables:
--   * owner_threads               - one row per thread
--   * owner_thread_participants   - many-to-many owner <-> thread
--   * owner_messages              - messages within a thread
--
-- Tenant scope (each tenant only sees its own threads / inbox; the
-- recipient tenant sees the thread via its own participant row):
--   tenant_id::text = current_setting('app.current_tenant_id', true)
--
-- RLS FORCE-enabled per CLAUDE.md. Idempotent. Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- owner_threads
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_threads (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  subject            text        NOT NULL,
  status             text        NOT NULL DEFAULT 'open',
  created_by_id      uuid        NOT NULL,
  last_activity_at   timestamptz NOT NULL DEFAULT now(),
  provenance         jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_hash_id      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_threads_status_chk'
  ) THEN
    ALTER TABLE owner_threads
      ADD CONSTRAINT owner_threads_status_chk
      CHECK (status IN ('open', 'closed', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS owner_threads_tenant_activity
  ON owner_threads (tenant_id, last_activity_at DESC);

ALTER TABLE owner_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_threads FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_threads'
       AND policyname = 'owner_threads_tenant_isolation'
  ) THEN
    CREATE POLICY owner_threads_tenant_isolation
      ON owner_threads
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- owner_thread_participants
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_thread_participants (
  thread_id     uuid        NOT NULL REFERENCES owner_threads(id) ON DELETE CASCADE,
  tenant_id     uuid        NOT NULL,
  owner_id      uuid        NOT NULL,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  role          text        NOT NULL DEFAULT 'observer',
  PRIMARY KEY (thread_id, owner_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'owner_thread_participants_role_chk'
  ) THEN
    ALTER TABLE owner_thread_participants
      ADD CONSTRAINT owner_thread_participants_role_chk
      CHECK (role IN ('initiator', 'recipient', 'observer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS owner_thread_participants_owner
  ON owner_thread_participants (owner_id, joined_at DESC);

ALTER TABLE owner_thread_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_thread_participants FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_thread_participants'
       AND policyname = 'owner_thread_participants_tenant_isolation'
  ) THEN
    CREATE POLICY owner_thread_participants_tenant_isolation
      ON owner_thread_participants
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- owner_messages
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_messages (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id     uuid        NOT NULL REFERENCES owner_threads(id) ON DELETE CASCADE,
  tenant_id     uuid        NOT NULL,
  sender_id     uuid        NOT NULL,
  body_md       text        NOT NULL,
  attachments   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  sent_at       timestamptz NOT NULL DEFAULT now(),
  read_by       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  provenance    jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  audit_hash_id text
);

CREATE INDEX IF NOT EXISTS owner_messages_thread_sent
  ON owner_messages (thread_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS owner_messages_tenant_sent
  ON owner_messages (tenant_id, sent_at DESC);

ALTER TABLE owner_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_messages FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_messages'
       AND policyname = 'owner_messages_tenant_isolation'
  ) THEN
    CREATE POLICY owner_messages_tenant_isolation
      ON owner_messages
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
