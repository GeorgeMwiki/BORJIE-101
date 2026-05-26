-- =============================================================================
-- Migration 0042 — Omnidata P0 Batch 1 (Slack + Email + Calendar connectors)
--
-- Spec: Docs/DESIGN/OMNI_P0_BATCH1_CONNECTORS_SPEC.md
--
-- Wave OMNI-P0-BATCH-1 lights up three concrete connector packages on top
-- of `@borjie/omnidata` (Wave 18CC catalogue + ingestion ports):
--
--   * @borjie/connector-slack    — Slack ingest (channels, threads, files,
--                                  reactions, presence).
--   * @borjie/connector-email    — Gmail + Outlook mail ingest (label-scoped,
--                                  OAuth, attachments to MinIO).
--   * @borjie/connector-calendar — Google + Outlook calendar ingest (events,
--                                  attendees, attachments).
--
-- Five tenant-scoped tables. Two of them (`connector_credentials`,
-- `connector_cursors`) are kind-generic and shared across every connector
-- the orchestrator ships. The other three (`slack_messages`,
-- `email_messages`, `calendar_events`) are kind-specific canonical row
-- tables that downstream cognitive-memory `observe` reads from.
--
-- Every token (OAuth access / refresh) is stored ENCRYPTED-AT-REST. The
-- canonical wire shape is `bytea` carrying AES-GCM ciphertext sealed with
-- a tenant-bound DEK. The application layer (`connector-*/auth/`) is the
-- only code path that decrypts; nothing in this database ever sees the
-- plaintext. Column comments mark the encryption contract so DBAs do not
-- accidentally `pg_dump` the bytes and assume they are safe.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration 0003.
-- Idempotent (`IF NOT EXISTS` + `DO` blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. connector_credentials — per-tenant per-account OAuth state
-- -----------------------------------------------------------------------------
--
-- One row per (tenant_id, connector_kind, connector_account). Account is
-- the provider-side identifier (Slack workspace id `T01ABC`, Gmail
-- address `mwikila@example.com`, etc.). Tokens are ENCRYPTED-AT-REST —
-- the column carries ciphertext only.

CREATE TABLE IF NOT EXISTS connector_credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  connector_kind      text NOT NULL,
  connector_account   text NOT NULL,
  access_token_enc    bytea,
  refresh_token_enc   bytea,
  scopes              text[] NOT NULL DEFAULT ARRAY[]::text[],
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL,
  CONSTRAINT connector_credentials_tenant_kind_account_uq
    UNIQUE (tenant_id, connector_kind, connector_account)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connector_credentials_kind_chk'
  ) THEN
    ALTER TABLE connector_credentials
      ADD CONSTRAINT connector_credentials_kind_chk
      CHECK (connector_kind IN (
        'slack',
        'gmail',
        'outlook_mail',
        'google_calendar',
        'outlook_calendar'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_connector_creds_tenant_kind
  ON connector_credentials (tenant_id, connector_kind);

CREATE INDEX IF NOT EXISTS idx_connector_creds_expiry
  ON connector_credentials (tenant_id, expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_credentials_tenant_rls
  ON connector_credentials;
CREATE POLICY connector_credentials_tenant_rls
  ON connector_credentials
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE connector_credentials IS
  'Wave OMNI-P0-BATCH-1 — per-tenant OAuth state for Slack / Email / Calendar connectors. access_token_enc and refresh_token_enc are AES-GCM ciphertext sealed with a tenant-bound DEK; the database NEVER sees plaintext.';

COMMENT ON COLUMN connector_credentials.access_token_enc IS
  'ENCRYPTED-AT-REST. AES-GCM ciphertext over the OAuth access token. Sealed with a tenant-bound DEK from KMS. The connector packages auth/token-refresh.ts is the only decrypt path.';

COMMENT ON COLUMN connector_credentials.refresh_token_enc IS
  'ENCRYPTED-AT-REST. AES-GCM ciphertext over the OAuth refresh token. Sealed with the same tenant-bound DEK as access_token_enc. Some providers (Google) rotate the refresh token on refresh — the application replaces both ciphertexts when that happens.';

-- -----------------------------------------------------------------------------
-- 2. connector_cursors — incremental ingest cursors
-- -----------------------------------------------------------------------------
--
-- Per (tenant_id, connector_kind, connector_account). Cursor is provider-
-- defined opaque text (Slack `latest` ts, Gmail `historyId`, Graph
-- `$deltaToken`, Google Calendar `nextSyncToken`).

CREATE TABLE IF NOT EXISTS connector_cursors (
  tenant_id           text NOT NULL,
  connector_kind      text NOT NULL,
  connector_account   text NOT NULL,
  cursor              text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, connector_kind, connector_account)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'connector_cursors_kind_chk'
  ) THEN
    ALTER TABLE connector_cursors
      ADD CONSTRAINT connector_cursors_kind_chk
      CHECK (connector_kind IN (
        'slack',
        'gmail',
        'outlook_mail',
        'google_calendar',
        'outlook_calendar'
      ));
  END IF;
END $$;

ALTER TABLE connector_cursors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_cursors_tenant_rls
  ON connector_cursors;
CREATE POLICY connector_cursors_tenant_rls
  ON connector_cursors
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE connector_cursors IS
  'Wave OMNI-P0-BATCH-1 — per (tenant, connector_kind, account) ingest cursor. Opaque text — interpretation is provider-defined.';

-- -----------------------------------------------------------------------------
-- 3. slack_messages — canonical Slack message rows
-- -----------------------------------------------------------------------------
--
-- One row per Slack message. PII inside `text` is already redacted at the
-- boundary (salted-sha256 via the connector's `redact/pii-redactor.ts`).
-- `raw` carries the post-redaction provider payload for downstream
-- diagnostic / replay. UNIQUE(tenant_id, workspace_id, channel_id, ts)
-- keeps ingest idempotent across replays.

CREATE TABLE IF NOT EXISTS slack_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  workspace_id  text NOT NULL,
  channel_id    text NOT NULL,
  ts            text NOT NULL,
  user_id       text,
  text          text,
  thread_ts     text,
  reactions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  files         jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash    text NOT NULL,
  CONSTRAINT slack_messages_tenant_ws_ch_ts_uq
    UNIQUE (tenant_id, workspace_id, channel_id, ts)
);

CREATE INDEX IF NOT EXISTS idx_slack_messages_tenant_ingested
  ON slack_messages (tenant_id, ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_slack_messages_thread
  ON slack_messages (tenant_id, workspace_id, channel_id, thread_ts)
  WHERE thread_ts IS NOT NULL;

ALTER TABLE slack_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS slack_messages_tenant_rls
  ON slack_messages;
CREATE POLICY slack_messages_tenant_rls
  ON slack_messages
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE slack_messages IS
  'Wave OMNI-P0-BATCH-1 — canonical Slack message row. `text` is post-redaction (salted-sha256 on PII). `raw` carries the post-redaction provider payload for replay.';

-- -----------------------------------------------------------------------------
-- 4. email_messages — canonical Gmail + Outlook mail rows
-- -----------------------------------------------------------------------------
--
-- One row per email. `provider` ∈ {gmail, outlook_mail}. Address fields
-- (`from_addr`, `to_addrs`) are post-redaction salted-sha256 hashes; the
-- raw plaintext addresses NEVER land here. Attachments are stored in
-- MinIO (see spec §4.2); only the storage URL + content hash live in the
-- `attachments` jsonb.

CREATE TABLE IF NOT EXISTS email_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  provider      text NOT NULL,
  account       text NOT NULL,
  message_id    text NOT NULL,
  thread_id     text,
  from_addr     text,
  to_addrs      text[] NOT NULL DEFAULT ARRAY[]::text[],
  subject       text,
  body_text     text,
  body_html     text,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash    text NOT NULL,
  CONSTRAINT email_messages_tenant_provider_account_msg_uq
    UNIQUE (tenant_id, provider, account, message_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_messages_provider_chk'
  ) THEN
    ALTER TABLE email_messages
      ADD CONSTRAINT email_messages_provider_chk
      CHECK (provider IN ('gmail', 'outlook_mail'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_messages_tenant_ingested
  ON email_messages (tenant_id, ingested_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_messages_thread
  ON email_messages (tenant_id, provider, account, thread_id)
  WHERE thread_id IS NOT NULL;

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_messages_tenant_rls
  ON email_messages;
CREATE POLICY email_messages_tenant_rls
  ON email_messages
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE email_messages IS
  'Wave OMNI-P0-BATCH-1 — canonical email row across Gmail + Outlook. `from_addr` and `to_addrs` are post-redaction salted-sha256 hashes; raw addresses NEVER land here.';

-- -----------------------------------------------------------------------------
-- 5. calendar_events — canonical Google + Outlook calendar event rows
-- -----------------------------------------------------------------------------
--
-- One row per calendar event. Recurring instances each materialise as
-- separate rows with their originalStartTime baked into event_id so the
-- UNIQUE(tenant_id, provider, account, calendar_id, event_id) dedup
-- stays stable across edits.

CREATE TABLE IF NOT EXISTS calendar_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  provider      text NOT NULL,
  account       text NOT NULL,
  calendar_id   text NOT NULL,
  event_id      text NOT NULL,
  summary       text,
  description   text,
  start_at      timestamptz,
  end_at        timestamptz,
  attendees     jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash    text NOT NULL,
  CONSTRAINT calendar_events_tenant_provider_account_cal_event_uq
    UNIQUE (tenant_id, provider, account, calendar_id, event_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_events_provider_chk'
  ) THEN
    ALTER TABLE calendar_events
      ADD CONSTRAINT calendar_events_provider_chk
      CHECK (provider IN ('google_calendar', 'outlook_calendar'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_calendar_events_tenant_start
  ON calendar_events (tenant_id, start_at);

CREATE INDEX IF NOT EXISTS idx_calendar_events_tenant_ingested
  ON calendar_events (tenant_id, ingested_at DESC);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_events_tenant_rls
  ON calendar_events;
CREATE POLICY calendar_events_tenant_rls
  ON calendar_events
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE calendar_events IS
  'Wave OMNI-P0-BATCH-1 — canonical calendar event row across Google + Outlook. Attendee email addresses inside `attendees` are post-redaction salted-sha256 hashes.';

COMMIT;
