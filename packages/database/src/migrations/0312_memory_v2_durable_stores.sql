-- =============================================================================
-- Migration 0312 — memory_v2 durable stores (MEM-01).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `@borjie/memory-v2` ships the six-layer cognitive substrate (episodic with
-- bi-temporal facts, narrative arcs, procedural skills, reflective notes,
-- topic files, cohort cache) but ONLY as in-memory reference impls
-- (`store-inmemory.ts`). In LIVE mode the gateway wires
-- `createInMemoryMemoryV2()` (service-registry.ts) — so every episode /
-- arc / skill / note is WIPED on each gateway restart (MASTER_GAP_REGISTER
-- MEM-01, BLOCKER). This migration creates the durable Postgres tables that
-- back the new Drizzle store adapters (`store-drizzle.ts`) selected at the
-- composition root when a DB handle is present, so the substrate SURVIVES a
-- process restart.
--
-- Seven tables (the episodic layer splits into episodes + facts):
--   * memory_v2_episodes           — bi-temporal episodes (pgvector embedding)
--   * memory_v2_episode_facts      — s/p/o facts attached to an episode
--   * memory_v2_narrative_arcs     — multi-episode arcs
--   * memory_v2_procedural_skills  — Voyager-style recurring skills
--   * memory_v2_reflective_notes   — Reflexion-style periodic notes
--   * memory_v2_topic_files        — topic-scoped memory shards
--   * memory_v2_cohort_cache       — per-tenant + per-jurisdiction cache
--
-- TENANT SCOPE (CLAUDE.md hard rule): every table is tenant-scoped (tenant_id
-- TEXT, no FK — same shape as the cognitive_memory_* family, migrations
-- 0029 / 0309). Each table FORCE-enables RLS with a tenant-isolation policy
-- on the canonical `app.current_tenant_id` GUC (bare compare, no cast; NEVER
-- the legacy `app.tenant_id`) plus a service-role bypass mirroring 0309 so the
-- composition root's system reads (withServiceRoleContext) are permitted.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. All NOT NULLs are
-- on freshly-created columns (no backfill hazard) so the NOT-NULL safety
-- validator passes.
--
-- Companion files:
--   * packages/database/src/schemas/memory-v2.schema.ts
--   * packages/memory-v2/src/{episodic,narrative,procedural,reflective,
--                              topic-files,cohort-cache}/store-drizzle.ts
-- =============================================================================

BEGIN;

-- pgvector for the episodic embedding column.
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- memory_v2_episodes — bi-temporal episodes (embedding for vector recall).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_v2_episodes (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  user_id      text        NOT NULL,
  surface      text        NOT NULL,
  subject      text,
  title        text,
  summary      text,
  valid_from   timestamptz NOT NULL,
  valid_to     timestamptz,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  embedding    vector(1536),
  tags         text[]      NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_mv2_ep_tenant_surface
  ON memory_v2_episodes (tenant_id, surface, recorded_at);
CREATE INDEX IF NOT EXISTS idx_mv2_ep_tenant_subject
  ON memory_v2_episodes (tenant_id, subject);
CREATE INDEX IF NOT EXISTS idx_mv2_ep_tenant_user
  ON memory_v2_episodes (tenant_id, user_id);

-- -----------------------------------------------------------------------------
-- memory_v2_episode_facts — bi-temporal subject/predicate/object facts.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_v2_episode_facts (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  episode_id   text        NOT NULL,
  subject      text        NOT NULL,
  predicate    text        NOT NULL,
  object       text        NOT NULL,
  confidence   numeric(4,3) NOT NULL DEFAULT 0.500,
  valid_from   timestamptz NOT NULL,
  valid_to     timestamptz,
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mv2_fact_episode
  ON memory_v2_episode_facts (episode_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_mv2_fact_tenant
  ON memory_v2_episode_facts (tenant_id);

-- -----------------------------------------------------------------------------
-- memory_v2_narrative_arcs — multi-episode arcs.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_v2_narrative_arcs (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  title        text        NOT NULL,
  summary      text        NOT NULL,
  episode_ids  text[]      NOT NULL DEFAULT '{}',
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz,
  tags         text[]      NOT NULL DEFAULT '{}',
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mv2_arc_tenant
  ON memory_v2_narrative_arcs (tenant_id, recorded_at);

-- -----------------------------------------------------------------------------
-- memory_v2_procedural_skills — Voyager-style recurring skills.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_v2_procedural_skills (
  id              text        PRIMARY KEY,
  tenant_id       text        NOT NULL,
  name            text        NOT NULL,
  description     text        NOT NULL,
  trigger_pattern text        NOT NULL,
  action_sequence jsonb       NOT NULL DEFAULT '[]'::jsonb,
  observed_count  integer     NOT NULL DEFAULT 1,
  success_rate    numeric(4,3) NOT NULL DEFAULT 0.000,
  promoted        text        NOT NULL DEFAULT 'false',
  last_seen_at    timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mv2_skill_tenant_promoted
  ON memory_v2_procedural_skills (tenant_id, promoted, last_seen_at);

-- -----------------------------------------------------------------------------
-- memory_v2_reflective_notes — Reflexion-style periodic notes.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_v2_reflective_notes (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  user_id      text,
  insight      text        NOT NULL,
  adjustments  text[]      NOT NULL DEFAULT '{}',
  period_start timestamptz NOT NULL,
  period_end   timestamptz NOT NULL,
  self_score   numeric(4,3) NOT NULL DEFAULT 0.500,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mv2_note_tenant_period
  ON memory_v2_reflective_notes (tenant_id, period_end);

-- -----------------------------------------------------------------------------
-- memory_v2_topic_files — topic-scoped memory shards.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_v2_topic_files (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  topic        text        NOT NULL,
  summary      text        NOT NULL,
  facts        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  episode_ids  text[]      NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mv2_topic_tenant_topic
  ON memory_v2_topic_files (tenant_id, topic);

-- -----------------------------------------------------------------------------
-- memory_v2_cohort_cache — per-tenant + per-jurisdiction cache layer.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_v2_cohort_cache (
  id           text        PRIMARY KEY,
  tenant_id    text        NOT NULL,
  jurisdiction text        NOT NULL DEFAULT '_global_',
  cache_key    text        NOT NULL,
  value        jsonb       NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mv2_cohort_tenant_juris
  ON memory_v2_cohort_cache (tenant_id, jurisdiction, cache_key);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass, applied
-- uniformly to all seven tables. Mirrors the 0309 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'memory_v2_episodes',
    'memory_v2_episode_facts',
    'memory_v2_narrative_arcs',
    'memory_v2_procedural_skills',
    'memory_v2_reflective_notes',
    'memory_v2_topic_files',
    'memory_v2_cohort_cache'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        tbl || '_tenant_isolation', tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_service_role_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
        || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
        tbl || '_service_role_bypass', tbl
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
