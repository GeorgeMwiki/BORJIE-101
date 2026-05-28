-- =============================================================================
-- Migration 0096 — Scope Nodes Taxonomy
--
-- Wave: SCOPE-SEGMENTATION. The MD reasons across many shapes of scope:
-- pit / site / region / subsidiary / cohort / parcel. This migration
-- lands a single hierarchical `scope_nodes` table that lets a tenant
-- assemble whatever taxonomy makes sense for their estate, plus a
-- `scope_taxonomy_preferences` row that maps canonical kinds to
-- display labels (sw + en).
--
-- Companion to:
--   - packages/database/src/schemas/scope-nodes.schema.ts
--   - services/api-gateway/src/routes/scope/scope.hono.ts
--   - services/api-gateway/src/services/md-intelligence/scope-roller.ts
--
-- INVARIANTS
--   - RLS FORCE on both tables.
--   - Idempotent — safe to re-run.
--   - Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) scope_nodes — hierarchical taxonomy tree.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scope_nodes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL,
  parent_id       uuid        REFERENCES scope_nodes(id) ON DELETE SET NULL,
  /** Canonical kind: pit | site | region | subsidiary | jv | cohort |
   *  parcel | crew | shift | other. The tenant maps each canonical
   *  kind to a display label via scope_taxonomy_preferences. */
  kind_canonical  text        NOT NULL,
  name            text        NOT NULL,
  /** Free-form identifiers (TIN, BRELA, GPS coords, etc.). */
  identifiers     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** Free-form attributes (commodity, area_km2, headcount, etc.). */
  attributes      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scope_nodes_kind_chk'
  ) THEN
    ALTER TABLE scope_nodes
      ADD CONSTRAINT scope_nodes_kind_chk
      CHECK (kind_canonical IN (
        'pit', 'site', 'region', 'country', 'subsidiary', 'jv',
        'cohort', 'parcel', 'crew', 'shift', 'group', 'other'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scope_nodes_tenant_parent
  ON scope_nodes (tenant_id, parent_id);

CREATE INDEX IF NOT EXISTS idx_scope_nodes_tenant_kind
  ON scope_nodes (tenant_id, kind_canonical, active);

ALTER TABLE scope_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope_nodes FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'scope_nodes'
       AND policyname = 'scope_nodes_tenant_isolation'
  ) THEN
    CREATE POLICY scope_nodes_tenant_isolation
      ON scope_nodes
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2) scope_taxonomy_preferences — per-tenant display label overrides.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scope_taxonomy_preferences (
  tenant_id           text        PRIMARY KEY,
  /** {pit: "Mgodi", site: "Eneo", ...}. */
  display_label_en    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  display_label_sw    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  default_kind        text        NOT NULL DEFAULT 'site',
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scope_taxonomy_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE scope_taxonomy_preferences FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'scope_taxonomy_preferences'
       AND policyname = 'stp_tenant_isolation'
  ) THEN
    CREATE POLICY stp_tenant_isolation
      ON scope_taxonomy_preferences
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
