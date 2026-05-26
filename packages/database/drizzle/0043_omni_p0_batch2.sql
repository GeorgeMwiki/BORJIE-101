-- =============================================================================
-- Migration 0043 — OMNI Phase 0 Batch 2 connector substrate
--                  (WhatsApp Business Cloud / Notion / Google Drive)
--
-- Spec: Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md
--
-- This migration creates the four provider-specific ingest tables for
-- Batch 2 of the OMNI Phase 0 connector wave:
--
--   1. whatsapp_messages — inbound + outbound message ledger
--   2. notion_pages      — page metadata + property bag
--   3. notion_blocks     — recursive block tree (incl. comments)
--   4. drive_files       — file metadata + extracted text
--
-- Uses connector_credentials, connector_cursors from migration 0042
-- (owned by sibling Wave OMNI-P0-BATCH-1: Slack / Email / Calendar).
-- This migration does NOT redeclare those tables. The Drizzle schemas
-- here reference them by name only.
--
-- Every table is tenant-scoped, RLS-policied via
-- `current_setting('app.tenant_id', true)` (canonical pattern from
-- migration 0003), and stamped with `audit_hash` for cross-walk into
-- @borjie/audit-hash-chain.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. whatsapp_messages — inbound + outbound message ledger
-- -----------------------------------------------------------------------------
--
-- One row per WhatsApp message in either direction. UNIQUE on
-- (tenant_id, waba_id, wa_message_id) so webhook retries from Meta
-- (up to 7-day retry window) are idempotent. `raw` holds the original
-- payload for legal-hold / replay; `media` and `contacts` carry the
-- normalised, redacted projections downstream consumers read.

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  waba_id           text NOT NULL,
  phone_number_id   text NOT NULL,
  wa_message_id     text NOT NULL,
  from_phone        text NOT NULL,
  to_phone          text NOT NULL,
  direction         text NOT NULL,
  kind              text NOT NULL,
  text              text,
  media             jsonb,
  contacts          jsonb,
  raw               jsonb NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  audit_hash        text NOT NULL,
  CONSTRAINT whatsapp_messages_tenant_uniq
    UNIQUE (tenant_id, waba_id, wa_message_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_messages_direction_chk'
  ) THEN
    ALTER TABLE whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_direction_chk
      CHECK (direction IN ('inbound', 'outbound'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_messages_kind_chk'
  ) THEN
    ALTER TABLE whatsapp_messages
      ADD CONSTRAINT whatsapp_messages_kind_chk
      CHECK (kind IN (
        'text', 'image', 'video', 'audio', 'document', 'sticker',
        'location', 'contacts', 'interactive', 'reaction', 'unknown'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_tenant_ingested
  ON whatsapp_messages (tenant_id, ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone
  ON whatsapp_messages (tenant_id, phone_number_id, ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_from
  ON whatsapp_messages (tenant_id, from_phone, ingested_at DESC);

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whatsapp_messages_tenant_rls ON whatsapp_messages;
CREATE POLICY whatsapp_messages_tenant_rls
  ON whatsapp_messages
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE whatsapp_messages IS
  'OMNI-P0-BATCH-2 — WhatsApp Business Cloud API message ledger. Inbound via webhook, reconciled via 6h poll. audit_hash anchors @borjie/audit-hash-chain.';

-- -----------------------------------------------------------------------------
-- 2. notion_pages — page metadata + property bag
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notion_pages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  workspace_id      text NOT NULL,
  page_id           text NOT NULL,
  parent_id         text,
  title             text,
  properties        jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_edited_at    timestamptz NOT NULL,
  raw               jsonb NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  audit_hash        text NOT NULL,
  CONSTRAINT notion_pages_tenant_uniq
    UNIQUE (tenant_id, workspace_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_notion_pages_tenant_edited
  ON notion_pages (tenant_id, last_edited_at DESC);

CREATE INDEX IF NOT EXISTS idx_notion_pages_parent
  ON notion_pages (tenant_id, workspace_id, parent_id)
  WHERE parent_id IS NOT NULL;

ALTER TABLE notion_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notion_pages_tenant_rls ON notion_pages;
CREATE POLICY notion_pages_tenant_rls
  ON notion_pages
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE notion_pages IS
  'OMNI-P0-BATCH-2 — Notion page metadata + property bag. Refreshed via /v1/search cursor on last_edited_time.';

-- -----------------------------------------------------------------------------
-- 3. notion_blocks — recursive block tree
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notion_blocks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  workspace_id      text NOT NULL,
  block_id          text NOT NULL,
  parent_id         text,
  kind              text NOT NULL,
  content           jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_edited_at    timestamptz NOT NULL,
  raw               jsonb NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  audit_hash        text NOT NULL,
  CONSTRAINT notion_blocks_tenant_uniq
    UNIQUE (tenant_id, workspace_id, block_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notion_blocks_kind_chk'
  ) THEN
    ALTER TABLE notion_blocks
      ADD CONSTRAINT notion_blocks_kind_chk
      CHECK (kind IN (
        'text', 'heading', 'list', 'quote', 'code',
        'image', 'file', 'embed', 'structural', 'comment'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notion_blocks_tenant_edited
  ON notion_blocks (tenant_id, last_edited_at DESC);

CREATE INDEX IF NOT EXISTS idx_notion_blocks_parent
  ON notion_blocks (tenant_id, workspace_id, parent_id)
  WHERE parent_id IS NOT NULL;

ALTER TABLE notion_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notion_blocks_tenant_rls ON notion_blocks;
CREATE POLICY notion_blocks_tenant_rls
  ON notion_blocks
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE notion_blocks IS
  'OMNI-P0-BATCH-2 — Notion block tree (incl. comments as kind=comment). Recursive via parent_id.';

-- -----------------------------------------------------------------------------
-- 4. drive_files — Google Drive file metadata + extracted text
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS drive_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  account           text NOT NULL,
  file_id           text NOT NULL,
  name              text NOT NULL,
  mime_type         text NOT NULL,
  parents           text[] NOT NULL DEFAULT ARRAY[]::text[],
  modified_at       timestamptz NOT NULL,
  extracted_text    text,
  raw               jsonb NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  audit_hash        text NOT NULL,
  CONSTRAINT drive_files_tenant_uniq
    UNIQUE (tenant_id, account, file_id)
);

CREATE INDEX IF NOT EXISTS idx_drive_files_tenant_modified
  ON drive_files (tenant_id, modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_drive_files_mime
  ON drive_files (tenant_id, mime_type);

ALTER TABLE drive_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS drive_files_tenant_rls ON drive_files;
CREATE POLICY drive_files_tenant_rls
  ON drive_files
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE drive_files IS
  'OMNI-P0-BATCH-2 — Google Drive file metadata + extracted plain text. Native gdoc/sheet/slide text via /v3/files/{id}/export.';

COMMIT;
