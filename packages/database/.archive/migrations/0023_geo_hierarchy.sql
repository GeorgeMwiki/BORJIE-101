-- =============================================================================
-- 0023: Per-Organization Geo-Hierarchy
-- =============================================================================
-- Materializes GeoLabelType / GeoNode / GeoNodeClosure / GeoAssignment.
--
-- Each organization defines its OWN label vocabulary and nesting direction
-- (e.g. a multi-district public-sector estate client: Districts > Regions >
-- Stations). `depth` is ORDINAL; it has no cross-org semantic meaning.
--
-- Polygons use JSONB (GeoJSON RFC 7946) for portability. A later migration
-- can swap in PostGIS geometry columns without changing domain-model types.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- geo_label_types
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geo_label_types (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  depth            INTEGER NOT NULL,
  singular         TEXT NOT NULL,
  plural           TEXT NOT NULL,
  color            TEXT,
  allows_polygon   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS geo_label_types_org_idx
  ON geo_label_types (organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS geo_label_types_org_depth_idx
  ON geo_label_types (organization_id, depth);

-- ---------------------------------------------------------------------------
-- geo_nodes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geo_nodes (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id        TEXT REFERENCES geo_nodes(id) ON DELETE CASCADE,
  label_type_id    TEXT NOT NULL REFERENCES geo_label_types(id),
  name             TEXT NOT NULL,
  code             TEXT,
  polygon          JSONB,
  centroid         JSONB,
  color_override   TEXT,
  order_index      INTEGER NOT NULL DEFAULT 0,
  metadata         JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS geo_nodes_org_idx
  ON geo_nodes (organization_id);

CREATE INDEX IF NOT EXISTS geo_nodes_parent_idx
  ON geo_nodes (parent_id);

CREATE INDEX IF NOT EXISTS geo_nodes_label_type_idx
  ON geo_nodes (label_type_id);

-- Natural key within an org: (parent, name). Enables idempotent seeding.
-- NULLS NOT DISTINCT so root nodes (parent_id=NULL) still unique per name.
CREATE UNIQUE INDEX IF NOT EXISTS geo_nodes_org_parent_name_idx
  ON geo_nodes (organization_id, COALESCE(parent_id, ''), name);

-- ---------------------------------------------------------------------------
-- geo_node_closure
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geo_node_closure (
  ancestor_id   TEXT NOT NULL REFERENCES geo_nodes(id) ON DELETE CASCADE,
  descendant_id TEXT NOT NULL REFERENCES geo_nodes(id) ON DELETE CASCADE,
  depth         INTEGER NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX IF NOT EXISTS geo_node_closure_descendant_idx
  ON geo_node_closure (descendant_id);

-- ---------------------------------------------------------------------------
-- geo_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geo_assignments (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  geo_node_id      TEXT NOT NULL REFERENCES geo_nodes(id) ON DELETE CASCADE,
  user_id          TEXT REFERENCES users(id) ON DELETE CASCADE,
  worker_tag_key   TEXT,
  responsibility   TEXT NOT NULL,
  inherits         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS geo_assignments_org_idx
  ON geo_assignments (organization_id);

CREATE INDEX IF NOT EXISTS geo_assignments_node_idx
  ON geo_assignments (geo_node_id);

CREATE INDEX IF NOT EXISTS geo_assignments_user_idx
  ON geo_assignments (user_id);

-- End of 0023
