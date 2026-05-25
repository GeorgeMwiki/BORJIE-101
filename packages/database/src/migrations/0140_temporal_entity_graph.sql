-- ─────────────────────────────────────────────────────────────────────
-- Migration 0140 — Temporal entity graph.
--
-- B4 / Central Command Phase B — Progressive Intelligence.
--
-- Zep / Graphiti-style bi-temporal knowledge graph for the brain's
-- semantic layer. The existing `kernel_memory_semantic` table holds
-- flat (tenant, user, key) → value facts; this layer adds the relational
-- structure (entity → relationship → entity) and the validity windows
-- ("Tenant John lived in unit 4B from Jan-15 to Mar-30") that the flat
-- store cannot represent.
--
-- Idempotent: every CREATE uses `IF NOT EXISTS`.
--
-- Used by:
--   - services/consolidation-worker stage 06-consolidate (Louvain
--     modularity-maximisation: https://arxiv.org/abs/0803.0476).
--   - Future kernel-side temporal-KG reader (Phase B+).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS temporal_entities (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,
  entity_key      TEXT NOT NULL,
  attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_to        TIMESTAMPTZ,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invalidated_at  TIMESTAMPTZ,
  community_id    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_temporal_entities_biz_key
  ON temporal_entities (tenant_id, entity_type, entity_key, valid_from);

CREATE INDEX IF NOT EXISTS idx_temporal_entities_tenant_type
  ON temporal_entities (tenant_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_temporal_entities_community
  ON temporal_entities (tenant_id, community_id);

CREATE INDEX IF NOT EXISTS idx_temporal_entities_valid_window
  ON temporal_entities (tenant_id, valid_from, valid_to);


CREATE TABLE IF NOT EXISTS temporal_relationships (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_entity_id  TEXT NOT NULL REFERENCES temporal_entities(id) ON DELETE CASCADE,
  to_entity_id    TEXT NOT NULL REFERENCES temporal_entities(id) ON DELETE CASCADE,
  relationship    TEXT NOT NULL,
  attributes      JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_from      TIMESTAMPTZ NOT NULL,
  valid_to        TIMESTAMPTZ,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invalidated_at  TIMESTAMPTZ,
  community_id    TEXT
);

CREATE INDEX IF NOT EXISTS idx_temporal_relationships_from
  ON temporal_relationships (tenant_id, from_entity_id);

CREATE INDEX IF NOT EXISTS idx_temporal_relationships_to
  ON temporal_relationships (tenant_id, to_entity_id);

CREATE INDEX IF NOT EXISTS idx_temporal_relationships_rel
  ON temporal_relationships (tenant_id, relationship);

CREATE INDEX IF NOT EXISTS idx_temporal_relationships_community
  ON temporal_relationships (tenant_id, community_id);


CREATE TABLE IF NOT EXISTS temporal_communities (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  size            INT NOT NULL DEFAULT 0,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm       TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_temporal_communities_tenant_size
  ON temporal_communities (tenant_id, size);


COMMENT ON TABLE temporal_entities IS
  'Zep/Graphiti-style typed nodes with bi-temporal validity windows. Never deleted; logically invalidated by consolidation-worker stage 06.';
COMMENT ON COLUMN temporal_entities.valid_from IS
  'When this fact became true in the world.';
COMMENT ON COLUMN temporal_entities.valid_to IS
  'When this fact stopped being true; NULL = still valid.';
COMMENT ON COLUMN temporal_entities.invalidated_at IS
  'When the brain learned this row is stale. Row is kept for replay; queries should filter on this.';
COMMENT ON COLUMN temporal_entities.community_id IS
  'Latest Louvain community-detection assignment. Back-ref to temporal_communities.id.';

COMMENT ON TABLE temporal_relationships IS
  'Typed edges between temporal_entities with their own validity windows. Same lifecycle as entities — invalidate, never delete.';

COMMENT ON TABLE temporal_communities IS
  'Output of nightly community detection (Louvain modularity-maximisation, arxiv 0803.0476). One row per detected community; entities and relationships point back via community_id.';
