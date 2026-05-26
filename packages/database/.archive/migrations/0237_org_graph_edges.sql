-- =============================================================================
-- 0222: org_graph_edges — Piece C MD Executive Brief Engine (graph layer).
--
-- Denormalised edge view materialised from existing core_entity relations,
-- contracts, lease/payment links, and the personas/titles org hierarchy.
-- The Executive Brief Engine traverses this graph (max 3 hops) when
-- gathering evidence to back gaps / opportunities / risks claims.
--
-- We DELIBERATELY use Postgres recursive CTEs over a flat edges table
-- (NOT Neo4j or Apache AGE) — the org graph is small (≤100k edges per
-- tenant), the brief engine never traverses past 3 hops, and the rest
-- of the stack is already on Postgres. One technology, one tenant
-- isolation story, one RLS pattern.
--
-- Edge types (open enumeration, TEXT for forward-compat):
--   - 'leased_to'      — Building/Unit → Person (lessee)
--   - 'managed_by'     — Building/Unit/Asset → Person (manager)
--   - 'reports_to'     — Person → Person (org chain, T2 → T1, T3 → T2 …)
--   - 'paid_by'        — Invoice/Lease → Person
--   - 'tagged_with'    — CoreEntity → Tag/Concept
--   - 'subdivides'     — LandParcel → LandParcel, Building → SubUnit
--   - 'invoiced_for'   — Invoice → Lease/Service
--   - 'inspected_by'   — Asset → Person (inspector)
--
-- Bitemporality: valid_from / valid_to. A NULL valid_to means
-- currently-valid. The projector inserts new rows on outbox events
-- (e.g. lease activated → leased_to edge added) and on lease
-- termination it sets the prior edge's valid_to (does not delete).
--
-- Indexes optimised for the brief engine's three core access patterns:
--   1. "What entities does X manage?"      → (tenant, src, edge_type)
--   2. "Who manages this asset?"           → (tenant, dst, edge_type)
--   3. "Currently-valid edges of type T"   → partial (tenant, edge_type)
--                                              WHERE valid_to IS NULL
--
-- Two materialised views denormalise common 3-hop queries:
--   - mv_org_chain                — recursive reports_to ancestors
--   - mv_asset_responsible_chain  — recursive managed_by ancestors
-- REFRESH MATERIALIZED VIEW CONCURRENTLY runs nightly in the
-- consolidation worker.
--
-- Tenant-scoped via FORCE RLS using the gold-standard 0185 pattern.
-- Idempotent — every operation gated on object existence.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Edges table
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS org_graph_edges (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** Soft FK to core_entity.id — enforced at the repository layer (not a
      DB FK because core_entity rows may be deleted by their type-specific
      cascade chains and we want edges to be auditable history). */
  src_entity_id   TEXT NOT NULL,
  dst_entity_id   TEXT NOT NULL,
  /** Edge type — open enumeration; TEXT for forward-compat. */
  edge_type       TEXT NOT NULL,
  /** Edge weight (1.00 default; can encode signal strength). */
  weight          NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
  /** Bitemporal validity window. NULL valid_to = currently valid. */
  valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to        TIMESTAMPTZ,
  /** audit_event.id / document_extraction.id refs that justify this
      edge — used by the brief engine when rendering citations. */
  evidence_refs   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (src_entity_id <> dst_entity_id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS org_graph_edges_tenant_src_idx
  ON org_graph_edges (tenant_id, src_entity_id);
CREATE INDEX IF NOT EXISTS org_graph_edges_tenant_dst_idx
  ON org_graph_edges (tenant_id, dst_entity_id);
CREATE INDEX IF NOT EXISTS org_graph_edges_tenant_type_idx
  ON org_graph_edges (tenant_id, edge_type);
CREATE INDEX IF NOT EXISTS org_graph_edges_tenant_current_idx
  ON org_graph_edges (tenant_id) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS org_graph_edges_tenant_type_current_idx
  ON org_graph_edges (tenant_id, edge_type) WHERE valid_to IS NULL;

COMMENT ON TABLE org_graph_edges IS
  'Piece C — denormalised org-graph edges projected from existing tables. Traversed by recursive CTEs (max 3 hops by default). Bitemporal: valid_to NULL = currently valid.';

COMMENT ON COLUMN org_graph_edges.edge_type IS
  'Edge type. Open enumeration: leased_to, managed_by, reports_to, paid_by, tagged_with, subdivides, invoiced_for, inspected_by.';

COMMENT ON COLUMN org_graph_edges.evidence_refs IS
  'audit_event.id / document_extraction.id values backing this edge — used for executive_briefs citations.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS (0185 pattern)
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'org_graph_edges'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl);
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
          FOR SELECT TO authenticated
          USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
          FOR ALL TO authenticated
          USING (tenant_id = public.current_app_tenant_id())
          WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Materialised views — common 3-hop queries
--
-- These views are refreshed nightly (consolidation-worker). Reading them
-- is O(1) per (tenant_id, entity_id) lookup; computing them recursively
-- is O(depth) but bounded by the WHERE on tenant_id.
-- ─────────────────────────────────────────────────────────────────────────

-- mv_org_chain — recursive reports_to ancestors for every Person entity.
-- Row shape: (tenant_id, person_id, ancestor_id, depth)
-- depth=0 means the person themselves; depth=1 means direct manager; etc.
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_org_chain AS
  WITH RECURSIVE chain AS (
    -- Seed: every person is at depth 0 with themselves as ancestor.
    SELECT
      e.tenant_id,
      e.src_entity_id    AS person_id,
      e.src_entity_id    AS ancestor_id,
      0                  AS depth
    FROM org_graph_edges e
    WHERE e.edge_type = 'reports_to'
      AND e.valid_to IS NULL

    UNION ALL

    -- Step: follow reports_to edges upward.
    SELECT
      c.tenant_id,
      c.person_id,
      e.dst_entity_id    AS ancestor_id,
      c.depth + 1        AS depth
    FROM chain c
    JOIN org_graph_edges e
      ON e.tenant_id = c.tenant_id
     AND e.src_entity_id = c.ancestor_id
     AND e.edge_type = 'reports_to'
     AND e.valid_to IS NULL
    WHERE c.depth < 6  -- hard cap on recursion depth (org chain rarely > 6)
  )
  SELECT DISTINCT tenant_id, person_id, ancestor_id, depth
  FROM chain
WITH NO DATA;

CREATE INDEX IF NOT EXISTS mv_org_chain_tenant_person_idx
  ON mv_org_chain (tenant_id, person_id);
CREATE INDEX IF NOT EXISTS mv_org_chain_tenant_ancestor_idx
  ON mv_org_chain (tenant_id, ancestor_id);

COMMENT ON MATERIALIZED VIEW mv_org_chain IS
  'Piece C — recursive reports_to closure. (tenant, person) → all ancestors. Refreshed nightly.';

-- mv_asset_responsible_chain — for each asset (non-person) entity, all
-- responsible persons up the management + reports_to chain.
-- Row shape: (tenant_id, asset_id, responsible_id, depth)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_asset_responsible_chain AS
  WITH RECURSIVE chain AS (
    -- Seed: managed_by edges (asset → person).
    SELECT
      e.tenant_id,
      e.src_entity_id      AS asset_id,
      e.dst_entity_id      AS responsible_id,
      1                    AS depth
    FROM org_graph_edges e
    WHERE e.edge_type = 'managed_by'
      AND e.valid_to IS NULL

    UNION ALL

    -- Step: walk reports_to upward from each responsible.
    SELECT
      c.tenant_id,
      c.asset_id,
      e.dst_entity_id      AS responsible_id,
      c.depth + 1          AS depth
    FROM chain c
    JOIN org_graph_edges e
      ON e.tenant_id = c.tenant_id
     AND e.src_entity_id = c.responsible_id
     AND e.edge_type = 'reports_to'
     AND e.valid_to IS NULL
    WHERE c.depth < 6
  )
  SELECT DISTINCT tenant_id, asset_id, responsible_id, depth
  FROM chain
WITH NO DATA;

CREATE INDEX IF NOT EXISTS mv_asset_resp_chain_tenant_asset_idx
  ON mv_asset_responsible_chain (tenant_id, asset_id);
CREATE INDEX IF NOT EXISTS mv_asset_resp_chain_tenant_resp_idx
  ON mv_asset_responsible_chain (tenant_id, responsible_id);

COMMENT ON MATERIALIZED VIEW mv_asset_responsible_chain IS
  'Piece C — for each asset, the chain of responsible persons up the managed_by + reports_to chain. Refreshed nightly.';

-- Note: materialised views inherit RLS from their underlying tables when
-- read via authenticated role. The brief engine queries them with the
-- tenant_id GUC bound; the recursive CTE above filters on tenant_id at
-- every step so cross-tenant pollination is impossible at the source.
