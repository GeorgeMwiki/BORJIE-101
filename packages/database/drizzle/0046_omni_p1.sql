-- =============================================================================
-- Migration 0046 — OMNI-P1 nine-connector persistence
--                  (Wave OMNI-P1)
--
-- Spec: Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md
--
-- Creates nine provider-specific ingest tables for the OMNI-P1 wave:
--
--   salesforce_records  — accounts, opps, contacts, cases
--   hubspot_records     — contacts, deals, tickets, marketing emails
--   linear_records      — issues, projects, cycles, comments
--   jira_records        — issues, epics, sprints, worklogs
--   github_records      — repos, PRs, issues, releases
--   gitlab_records      — projects, MRs, issues, pipelines
--   teams_messages      — Microsoft Teams channel messages + meetings
--   zoom_meetings       — Zoom meetings + recordings + transcripts
--   voice_calls         — Twilio voice (sub-account, distinct from SMS notifier)
--
-- Cross-table invariants:
--   * Every row carries `tenant_id text NOT NULL` for RLS scoping.
--   * Every row carries `account text NOT NULL` — the per-provider workspace
--     identifier (Salesforce org id, HubSpot portal id, Linear team key, Jira
--     site, GitHub org, GitLab group, Teams tenant, Zoom account, Twilio
--     sub-account SID). Distinct from `tenant_id` so a single Borjie tenant
--     can connect multiple upstream accounts.
--   * `raw jsonb` stores the immutable upstream payload, salted-hash redacted
--     at the ingest boundary (the connector's `pii-redactor.ts`).
--   * `ingested_at timestamptz NOT NULL DEFAULT now()` for retention windows.
--   * `audit_hash text NOT NULL` chains into `ai_audit_chain` (migration 0011).
--   * Every table has a UNIQUE compound index so re-ingest is idempotent.
--   * RLS enabled with the canonical `app.tenant_id` GUC policy.
--
-- Shared infrastructure: the connector-wide `connector_credentials` and
-- `connector_cursors` tables come from migration 0042_connector_framework.sql
-- (planned). This migration REFERENCES them only — no FK constraints (so
-- 0046 applies cleanly with or without 0042 in place at apply time).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. salesforce_records — accounts, opps, contacts, cases
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS salesforce_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  account             text NOT NULL,
  sobject_type        text NOT NULL,
  sobject_id          text NOT NULL,
  fields              jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_modified_date  timestamptz NOT NULL,
  raw                 jsonb NOT NULL,
  ingested_at         timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL,
  CONSTRAINT salesforce_records_uq
    UNIQUE (tenant_id, account, sobject_type, sobject_id)
);

CREATE INDEX IF NOT EXISTS idx_salesforce_records_tenant_lmd
  ON salesforce_records (tenant_id, last_modified_date DESC);

ALTER TABLE salesforce_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salesforce_records_tenant_rls ON salesforce_records;
CREATE POLICY salesforce_records_tenant_rls ON salesforce_records
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE salesforce_records IS
  'OMNI-P1 — Salesforce SObject ingest. References shared connector_credentials / connector_cursors from migration 0042 (no FK).';

-- -----------------------------------------------------------------------------
-- 2. hubspot_records — contacts, deals, tickets, marketing emails
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hubspot_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  account       text NOT NULL,
  object_type   text NOT NULL,
  object_id     text NOT NULL,
  properties    jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL,
  raw           jsonb NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash    text NOT NULL,
  CONSTRAINT hubspot_records_uq
    UNIQUE (tenant_id, account, object_type, object_id)
);

CREATE INDEX IF NOT EXISTS idx_hubspot_records_tenant_updated
  ON hubspot_records (tenant_id, updated_at DESC);

ALTER TABLE hubspot_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hubspot_records_tenant_rls ON hubspot_records;
CREATE POLICY hubspot_records_tenant_rls ON hubspot_records
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE hubspot_records IS
  'OMNI-P1 — HubSpot CRM/marketing object ingest. References shared connector_credentials from migration 0042 (no FK).';

-- -----------------------------------------------------------------------------
-- 3. linear_records — issues, projects, cycles, comments
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS linear_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  account       text NOT NULL,
  entity_kind   text NOT NULL,
  entity_id     text NOT NULL,
  fields        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL,
  raw           jsonb NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash    text NOT NULL,
  CONSTRAINT linear_records_uq
    UNIQUE (tenant_id, account, entity_kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_linear_records_tenant_updated
  ON linear_records (tenant_id, updated_at DESC);

ALTER TABLE linear_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS linear_records_tenant_rls ON linear_records;
CREATE POLICY linear_records_tenant_rls ON linear_records
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE linear_records IS
  'OMNI-P1 — Linear (issues, projects, cycles, comments) ingest. References shared connector_credentials from migration 0042 (no FK).';

-- -----------------------------------------------------------------------------
-- 4. jira_records — issues, epics, sprints, worklogs
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jira_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  account       text NOT NULL,
  entity_kind   text NOT NULL,
  entity_id     text NOT NULL,
  fields        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL,
  raw           jsonb NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash    text NOT NULL,
  CONSTRAINT jira_records_uq
    UNIQUE (tenant_id, account, entity_kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_jira_records_tenant_updated
  ON jira_records (tenant_id, updated_at DESC);

ALTER TABLE jira_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jira_records_tenant_rls ON jira_records;
CREATE POLICY jira_records_tenant_rls ON jira_records
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE jira_records IS
  'OMNI-P1 — Jira (issues, epics, sprints, worklogs) ingest. References shared connector_credentials from migration 0042 (no FK).';

-- -----------------------------------------------------------------------------
-- 5. github_records — repos, PRs, issues, releases
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS github_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  account       text NOT NULL,
  entity_kind   text NOT NULL,
  entity_id     text NOT NULL,
  fields        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL,
  raw           jsonb NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash    text NOT NULL,
  CONSTRAINT github_records_uq
    UNIQUE (tenant_id, account, entity_kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_github_records_tenant_updated
  ON github_records (tenant_id, updated_at DESC);

ALTER TABLE github_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS github_records_tenant_rls ON github_records;
CREATE POLICY github_records_tenant_rls ON github_records
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE github_records IS
  'OMNI-P1 — GitHub (repos, PRs, issues, releases) ingest. Dedicated to OMNI-P1; distinct from junior-spawner''s GitHub touchpoints.';

-- -----------------------------------------------------------------------------
-- 6. gitlab_records — projects, MRs, issues, pipelines
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gitlab_records (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  account       text NOT NULL,
  entity_kind   text NOT NULL,
  entity_id     text NOT NULL,
  fields        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL,
  raw           jsonb NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash    text NOT NULL,
  CONSTRAINT gitlab_records_uq
    UNIQUE (tenant_id, account, entity_kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_gitlab_records_tenant_updated
  ON gitlab_records (tenant_id, updated_at DESC);

ALTER TABLE gitlab_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gitlab_records_tenant_rls ON gitlab_records;
CREATE POLICY gitlab_records_tenant_rls ON gitlab_records
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE gitlab_records IS
  'OMNI-P1 — GitLab (projects, MRs, issues, pipelines) ingest. Self-hosted base URLs supported.';

-- -----------------------------------------------------------------------------
-- 7. teams_messages — Microsoft Teams channel messages + meetings
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS teams_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  account       text NOT NULL,
  team_id       text NOT NULL,
  channel_id    text NOT NULL,
  message_id    text NOT NULL,
  from_user     text NOT NULL,
  content       text,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_at       timestamptz NOT NULL,
  raw           jsonb NOT NULL,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  audit_hash    text NOT NULL,
  CONSTRAINT teams_messages_uq
    UNIQUE (tenant_id, account, team_id, channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_teams_messages_tenant_sent
  ON teams_messages (tenant_id, sent_at DESC);

ALTER TABLE teams_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS teams_messages_tenant_rls ON teams_messages;
CREATE POLICY teams_messages_tenant_rls ON teams_messages
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE teams_messages IS
  'OMNI-P1 — Microsoft Teams channel messages. Driven by Graph change-notification subscriptions with polling fallback.';

-- -----------------------------------------------------------------------------
-- 8. zoom_meetings — Zoom meetings + recordings + transcripts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS zoom_meetings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  account           text NOT NULL,
  meeting_id        text NOT NULL,
  topic             text,
  start_at          timestamptz NOT NULL,
  end_at            timestamptz,
  participants      jsonb NOT NULL DEFAULT '[]'::jsonb,
  recording_uri     text,
  transcript_text   text,
  raw               jsonb NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  audit_hash        text NOT NULL,
  CONSTRAINT zoom_meetings_uq
    UNIQUE (tenant_id, account, meeting_id),
  CONSTRAINT zoom_meetings_endafter_chk
    CHECK (end_at IS NULL OR end_at >= start_at)
);

CREATE INDEX IF NOT EXISTS idx_zoom_meetings_tenant_start
  ON zoom_meetings (tenant_id, start_at DESC);

ALTER TABLE zoom_meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS zoom_meetings_tenant_rls ON zoom_meetings;
CREATE POLICY zoom_meetings_tenant_rls ON zoom_meetings
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE zoom_meetings IS
  'OMNI-P1 — Zoom meetings, recordings, transcripts. Driven by recording.completed / transcript_completed webhooks.';

-- -----------------------------------------------------------------------------
-- 9. voice_calls — Twilio voice (sub-account)
-- -----------------------------------------------------------------------------
--
-- Distinct from `services/wave-resilience-manager`'s SMS notifier. Shares
-- TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN root credentials but operates under
-- TWILIO_VOICE_SUBACCOUNT_SID so per-second voice TPS, billing, and incident
-- scope are partitioned.

CREATE TABLE IF NOT EXISTS voice_calls (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL,
  twilio_account    text NOT NULL,
  call_sid          text NOT NULL,
  direction         text NOT NULL,
  from_phone        text NOT NULL,
  to_phone          text NOT NULL,
  duration_s        integer,
  recording_uri     text,
  transcript_text   text,
  raw               jsonb NOT NULL,
  ingested_at       timestamptz NOT NULL DEFAULT now(),
  audit_hash        text NOT NULL,
  CONSTRAINT voice_calls_uq
    UNIQUE (tenant_id, twilio_account, call_sid),
  CONSTRAINT voice_calls_direction_chk
    CHECK (direction IN ('inbound', 'outbound-api', 'outbound-dial', 'outbound'))
);

CREATE INDEX IF NOT EXISTS idx_voice_calls_tenant_ingested
  ON voice_calls (tenant_id, ingested_at DESC);

ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS voice_calls_tenant_rls ON voice_calls;
CREATE POLICY voice_calls_tenant_rls ON voice_calls
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMENT ON TABLE voice_calls IS
  'OMNI-P1 — Twilio voice ingest. Uses dedicated sub-account distinct from SMS notifier.';

COMMIT;
