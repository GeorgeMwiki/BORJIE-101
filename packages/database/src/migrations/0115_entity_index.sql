-- =============================================================================
-- Migration 0115 - Entity Index + Cross References (Wave ENTITY-LEGIBILITY)
--
-- Companion to:
--   - packages/database/src/schemas/entity-index.schema.ts
--   - services/api-gateway/src/workers/entity-indexer-worker.ts
--   - services/api-gateway/src/composition/brain-tools/entity-legibility-tools.ts
--   - services/api-gateway/src/services/cross-reference-discovery/
--   - Docs/DESIGN/ENTITY_LEGIBILITY_INDEX.md
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Two tables back the "entire org fully legible to AI" contract: every
-- entity in the system (licences, royalty drafts, drill holes, parcels,
-- bids, incidents, employees, counterparties, reminders, documents, ...)
-- is indexed with a semantic embedding plus a tag set, and every pair
-- of related entities is captured as a typed cross-reference so the
-- brain can traverse the graph in one hop.
--
--   1. entity_index            - one row per (tenant_id, entity_kind,
--                                entity_id) carrying display_name,
--                                embedding (pgvector), tags, summary,
--                                lifecycle_stage, refreshed_at.
--   2. entity_cross_references - typed (source -> target) edges with a
--                                relationship enum + confidence + the
--                                derivation_source so the discoverer can
--                                rebuild the edge from joins.
--
-- Tenant-scoped via the canonical `app.tenant_id` GUC RLS predicate.
-- RLS is FORCE-enabled on both tables per the Borjie hard rule
-- (CLAUDE.md). entity_cross_references inherits tenant scope from the
-- source row (the discoverer always writes both source + target in the
-- same tenant context).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" - never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- pgvector for the semantic embedding column. Guarded the same way as
-- 0125/0133/0178: emit NOTICE if the extension is unavailable so the
-- migration chain keeps moving on stock Postgres images. Production
-- (Supabase, Neon, RDS with shared_preload_libraries) ships pgvector;
-- absence is a deployment-time misconfig surfaced via Docs/RUNBOOK.md.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '0115: pgvector unavailable: %', SQLERRM;
END $$;

-- -----------------------------------------------------------------------------
-- entity_kind + lifecycle_stage enums
-- -----------------------------------------------------------------------------
-- entity_kind is open-ended: the worker registers a new entity kind by
-- inserting rows; no schema migration required to add a kind. We keep
-- the column as text (not an enum type) so the indexer can grow with
-- the platform without coupling every new entity kind to a migration.
--
-- lifecycle_stage is bounded: draft (not yet active), active (current
-- working state), dormant (paused, not deleted), archived (no longer
-- mutating but still legible), deleted (soft delete; brain still sees
-- it so the owner can ask "what happened to X").
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'entity_lifecycle_stage'
  ) THEN
    CREATE TYPE entity_lifecycle_stage AS ENUM (
      'draft', 'active', 'dormant', 'archived', 'deleted'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'entity_cross_ref_relationship'
  ) THEN
    CREATE TYPE entity_cross_ref_relationship AS ENUM (
      'parent', 'child', 'related', 'duplicate', 'depends_on', 'supersedes'
    );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1) entity_index
-- -----------------------------------------------------------------------------
-- One row per (tenant_id, entity_kind, entity_id). The worker upserts
-- on a fixed cadence; the unique index makes the upsert race-safe.
-- embedding may be NULL when OPENAI_API_KEY is missing in the
-- environment, the brain tools degrade to fuzzy text matching on
-- display_name + tags + summary in that case.
CREATE TABLE IF NOT EXISTS entity_index (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  /** Entity kind (licence / royalty_draft / drill_hole / parcel / bid /
   *  incident / employee / counterparty / document / reminder / ...).
   *  Open enum at the database layer; constrained at the API layer
   *  via the kind registry (`entity-kinds.ts`). */
  entity_kind     text        NOT NULL,
  /** Stable identifier within the kind. Always text so we can index
   *  uuids, slugs, composite keys uniformly. */
  entity_id       text        NOT NULL,
  /** Human-readable label the brain returns to the owner. */
  display_name    text        NOT NULL,
  /** Optional semantic embedding (1536 dims, OpenAI text-embedding-3-
   *  small). NULL when no embedder is configured. */
  embedding       vector(1536),
  /** Faceted tags extracted from canonical fields: site slug, mineral,
   *  status, regulator id, counterparty id, etc. Drives fast GIN
   *  lookups for kind-filtered searches. */
  tags            text[]      NOT NULL DEFAULT ARRAY[]::text[],
  /** 1-2 sentence summary the brain can quote verbatim in its reply. */
  summary         text        NOT NULL DEFAULT '',
  lifecycle_stage entity_lifecycle_stage NOT NULL DEFAULT 'active',
  /** When the source row last changed (mirrors source.updated_at). */
  updated_at      timestamptz NOT NULL DEFAULT now(),
  /** When the indexer last refreshed this row (used to detect drift). */
  refreshed_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Race-safe upsert key. Composite so the indexer can ON CONFLICT
-- (tenant_id, entity_kind, entity_id) DO UPDATE without ambiguity.
CREATE UNIQUE INDEX IF NOT EXISTS entity_index_natural_key_idx
  ON entity_index (tenant_id, entity_kind, entity_id);

-- Hot path: per-tenant recent activity per kind ("show me recent drill
-- holes"). Ordered by refreshed_at DESC so the brain's `entity.recent`
-- tool finds them in one index lookup.
CREATE INDEX IF NOT EXISTS entity_index_recent_idx
  ON entity_index (tenant_id, entity_kind, refreshed_at DESC);

-- Tag lookup for kind-agnostic filter ("everything tagged geita").
CREATE INDEX IF NOT EXISTS entity_index_tags_gin_idx
  ON entity_index USING gin (tags);

-- Lifecycle filter ("only show active entities by default").
CREATE INDEX IF NOT EXISTS entity_index_lifecycle_idx
  ON entity_index (tenant_id, lifecycle_stage)
  WHERE lifecycle_stage = 'active';

-- HNSW index over the embedding for semantic search. Guarded inside
-- DO/EXCEPTION so a pgvector build without HNSW (older builds shipped
-- only ivfflat) still applies the migration; the read path falls back
-- to a sequential scan in that case.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = current_schema()
       AND tablename = 'entity_index'
       AND indexname = 'entity_index_embedding_hnsw_idx'
  ) THEN
    EXECUTE 'CREATE INDEX entity_index_embedding_hnsw_idx
             ON entity_index
             USING hnsw (embedding vector_cosine_ops)
             WITH (m = 16, ef_construction = 64)
             WHERE embedding IS NOT NULL';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '0115: HNSW index build deferred (pgvector version may lack hnsw): %', SQLERRM;
END $$;

ALTER TABLE entity_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_index FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'entity_index'
       AND policyname = 'entity_index_tenant_isolation'
  ) THEN
    CREATE POLICY entity_index_tenant_isolation
      ON entity_index
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) entity_cross_references
-- -----------------------------------------------------------------------------
-- Typed edges between entities. Composite PK on the four key columns
-- so we never store duplicate edges with the same kind. Tenant scoping
-- is implicit via the source row (the discoverer always writes the
-- tenant_id explicitly so RLS can enforce it).
CREATE TABLE IF NOT EXISTS entity_cross_references (
  tenant_id           text        NOT NULL,
  source_kind         text        NOT NULL,
  source_id           text        NOT NULL,
  target_kind         text        NOT NULL,
  target_id           text        NOT NULL,
  relationship        entity_cross_ref_relationship NOT NULL,
  /** 0..1; the discoverer sets 1.0 for foreign-key derived edges and
   *  lower for similarity/duplicate suggestions. */
  confidence          numeric(4,3) NOT NULL DEFAULT 1.000,
  /** When the discoverer last computed this edge. */
  derived_at          timestamptz NOT NULL DEFAULT now(),
  /** Pure function name in cross-reference-discovery that produced the
   *  edge, e.g. "discoverForRoyaltyDraft". Stored so the worker can
   *  re-run only the relevant discoverers on a source-row update. */
  derivation_source   text        NOT NULL DEFAULT '',
  /** Free-form annotation (e.g. the join column used). */
  metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, source_kind, source_id, target_kind, target_id, relationship)
);

-- Traverse forward from a source entity (`entity.full_picture`).
CREATE INDEX IF NOT EXISTS entity_cross_references_forward_idx
  ON entity_cross_references (tenant_id, source_kind, source_id);

-- Traverse backward from a target entity ("what points at this").
CREATE INDEX IF NOT EXISTS entity_cross_references_reverse_idx
  ON entity_cross_references (tenant_id, target_kind, target_id);

-- Relationship-filtered traversal ("only duplicates" / "only parents").
CREATE INDEX IF NOT EXISTS entity_cross_references_relationship_idx
  ON entity_cross_references (tenant_id, relationship, source_kind);

ALTER TABLE entity_cross_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_cross_references FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'entity_cross_references'
       AND policyname = 'entity_cross_references_tenant_isolation'
  ) THEN
    CREATE POLICY entity_cross_references_tenant_isolation
      ON entity_cross_references
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
