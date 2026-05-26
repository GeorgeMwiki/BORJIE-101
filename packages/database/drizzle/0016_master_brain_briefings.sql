-- =============================================================================
-- Migration 0016 — Master Brain autonomous-loops schema (Wave 17)
--
-- Companion to docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md and
-- docs/DESIGN/AUTONOMOUS_LOOPS_SPEC.md. Adds the persistence substrate
-- for the 4 autonomous loops that turn Mr. Mwikila into a 24/7 Managing
-- Director:
--
--   1. master_brain_briefings  — citation-anchored morning briefings +
--      overnight draft plans authored by the Daily Research + Sleep-Pass
--      loops.
--   2. spawn_proposals         — Anticipatory UX next-3-moves proposals.
--   3. passive_capture_events  — entity extraction trace per chat turn
--      (avoids re-processing the same turn).
--   4. daily_research_cache    — per-source rate-limited fetch cache.
--
-- All 4 tables are tenant-scoped and gated by RLS using the canonical
-- `app.tenant_id` GUC pattern established in migration 0003. Indexes
-- match the read-path hotspots in the spec.
--
-- Idempotent (IF NOT EXISTS, DO blocks for policy creation). Safe to
-- re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
-- pgcrypto powers gen_random_uuid(); pgvector / postgis / timescaledb
-- already loaded by migration 0003.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. master_brain_briefings — citation-anchored daily briefings
-- -----------------------------------------------------------------------------
-- Generated nightly by the Sleep-Pass Loop (status='draft') and finalised
-- by the Daily Research Loop at 04:00 local (status='final'). Each row
-- carries `evidence_ids[]` for the underlying corpus + research artifacts.

CREATE TABLE IF NOT EXISTS master_brain_briefings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  generated_at       timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL DEFAULT 'final',
  summary_md         text NOT NULL,
  evidence_ids       text[] NOT NULL DEFAULT ARRAY[]::text[],
  actions_proposed   jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_seen_at      timestamptz,
  owner_actioned_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_brain_briefings_status_chk
    CHECK (status IN ('draft','final','superseded'))
);

CREATE INDEX IF NOT EXISTS master_brain_briefings_tenant_generated_idx
  ON master_brain_briefings(tenant_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS master_brain_briefings_status_idx
  ON master_brain_briefings(tenant_id, status);
CREATE INDEX IF NOT EXISTS master_brain_briefings_unseen_idx
  ON master_brain_briefings(tenant_id, owner_seen_at)
  WHERE owner_seen_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. spawn_proposals — Anticipatory UX next-move suggestions
-- -----------------------------------------------------------------------------
-- One row per (turn, candidate-move) emitted by the Anticipatory UX Loop.
-- Lifecycle: proposed → accepted | dismissed | expired. Accept/dismiss
-- flips status; the move-template scorer reads outcomes for online
-- learning.

CREATE TABLE IF NOT EXISTS spawn_proposals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_turn_id  text NOT NULL,
  entity_kind     text NOT NULL,
  entity_payload  jsonb NOT NULL,
  target_tab      text,
  target_form_id  text,
  prefill         jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence      numeric(4,3) NOT NULL,
  status          text NOT NULL DEFAULT 'proposed',
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  CONSTRAINT spawn_proposals_status_chk
    CHECK (status IN ('proposed','accepted','dismissed','expired')),
  CONSTRAINT spawn_proposals_confidence_chk
    CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS spawn_proposals_tenant_status_created_idx
  ON spawn_proposals(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS spawn_proposals_source_turn_idx
  ON spawn_proposals(source_turn_id);
CREATE INDEX IF NOT EXISTS spawn_proposals_entity_kind_idx
  ON spawn_proposals(tenant_id, entity_kind);
CREATE INDEX IF NOT EXISTS spawn_proposals_pending_idx
  ON spawn_proposals(tenant_id, created_at DESC)
  WHERE status = 'proposed';

-- -----------------------------------------------------------------------------
-- 3. passive_capture_events — entity-extraction trace per chat/voice turn
-- -----------------------------------------------------------------------------
-- Lets the Anticipatory UX Loop short-circuit on already-processed turns.
-- `draft_state_ref` points at the spawn_proposals row this capture seeded
-- (nullable until a proposal lands).

CREATE TABLE IF NOT EXISTS passive_capture_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id        text NOT NULL,
  captured_at       timestamptz NOT NULL DEFAULT now(),
  source            text NOT NULL,
  entities          jsonb NOT NULL,
  draft_state_ref   uuid REFERENCES spawn_proposals(id) ON DELETE SET NULL,
  CONSTRAINT passive_capture_events_source_chk
    CHECK (source IN ('chat','voice','upload'))
);

CREATE INDEX IF NOT EXISTS passive_capture_events_tenant_session_idx
  ON passive_capture_events(tenant_id, session_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS passive_capture_events_source_idx
  ON passive_capture_events(tenant_id, source);
CREATE INDEX IF NOT EXISTS passive_capture_events_draft_state_idx
  ON passive_capture_events(draft_state_ref);

-- -----------------------------------------------------------------------------
-- 4. daily_research_cache — per-source rate-limited fetch cache
-- -----------------------------------------------------------------------------
-- The Daily Research Loop respects per-source TTLs (e.g. LME = 5 min,
-- regulator scrapes = 1 h). Rows are upserted on (tenant_id, source) when
-- the TTL elapses.

CREATE TABLE IF NOT EXISTS daily_research_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL,
  payload     jsonb NOT NULL,
  ttl_until   timestamptz NOT NULL,
  CONSTRAINT daily_research_cache_source_chk
    CHECK (source IN ('lme','kitco','tra','nemc','tumemadini','bot-gold-window','web'))
);

CREATE INDEX IF NOT EXISTS daily_research_cache_tenant_source_ttl_idx
  ON daily_research_cache(tenant_id, source, ttl_until DESC);
CREATE INDEX IF NOT EXISTS daily_research_cache_fetched_at_idx
  ON daily_research_cache(tenant_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS daily_research_cache_live_idx
  ON daily_research_cache(tenant_id, source, ttl_until)
  WHERE ttl_until > now();

-- -----------------------------------------------------------------------------
-- 5. Row Level Security — every table tenant-scoped on `app.tenant_id`.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'master_brain_briefings',
    'spawn_proposals',
    'passive_capture_events',
    'daily_research_cache'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0016_master_brain_briefings.sql
-- =============================================================================
