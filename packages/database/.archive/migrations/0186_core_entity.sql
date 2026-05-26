-- @safety: dynamic-not-null-reviewed
-- Reviewed 2026-05-25: every NOT NULL inside this file's DO/EXECUTE blocks
-- lives inside a `CREATE TABLE IF NOT EXISTS core_entity (...)` body, so the
-- constraint lands on a newly-created column with zero rows (trivially safe
-- — the same NEW_TABLE classification the static analyser would assign if
-- the CREATE TABLE were not wrapped in EXECUTE for the PostGIS-availability
-- fallback). No ALTER COLUMN ... SET NOT NULL is issued against an
-- existing table; the dynamic indirection exists solely to switch the
-- geo_geog column between geography(GEOMETRY, 4326) and JSONB based on
-- whether the PostGIS extension is installed.
-- =============================================================================
-- 0186: core_entity — Piece A universal asset & entity model (polymorphic root).
--
-- The single, polymorphic row-store for EVERY tangible or intangible
-- asset / actor a tenant owns or manages:
--
--   * Land parcels (incl. subdivisions via parent_entity_id)
--   * Buildings (warehouse, godown, hotel, office, mixed, residential)
--   * Sub-units (rooms, suites, retail bays within a building)
--   * Vehicles + locomotives
--   * Machinery + plant
--   * IT assets (laptop, phone, server, network device)
--   * Intangibles (licences, contracts, patents)
--   * People (tenants, owners, staff, vendors as `PERSON` rows)
--
-- The narrow-and-deep design: ONE root table + thin per-type extension
-- tables (`entity_ext_*`) FK'd to `core_entity.id`. Domain-specific
-- attributes live in extensions; truly tenant-bespoke fields live in
-- `core_entity.custom_fields` JSONB with optional Zod validation via
-- `tenant_schema_extensions` (migration 0188).
--
-- This migration:
--
--   1. Installs the `vector` extension (already present from 0178 in
--      most environments — guarded with DO/EXCEPTION).
--   2. Installs the `postgis` extension. Failure to install is logged
--      as a NOTICE; the `geo_geog` column degrades to NULL-only on
--      that environment. (PostGIS is built-in on Supabase, AWS RDS
--      Postgres-15+, Neon, Render. Self-host: install postgis-15.)
--   3. Creates `core_entity` — tenant-scoped polymorphic root.
--   4. Installs the canonical gold-standard RLS pattern from 0182/0183/
--      0184/0185 (ENABLE + FORCE + tenant_isolation_{select,modify}
--      + REVOKE FROM anon).
--   5. Installs the tsvector update trigger so `tsv` is automatically
--      populated from (display_name + custom_fields::text +
--      coalesce(discriminator,'')). BM25-style hybrid retrieval.
--
-- Idempotent: every operation gated on object existence; safe to re-run
-- on a fresh database. Migration numbers 0186-0194 are exclusively
-- owned by Piece A; other pieces never touch them.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Ensure required extensions exist (idempotent + fail-soft for dev).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  RAISE NOTICE 'pgvector extension installed (or already present).';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'pgvector extension NOT available on this server (SQLSTATE=%, message=%). '
    'core_entity.embedding ANN search will be unavailable; the column '
    'remains NULLable so writes continue to succeed. See '
    'Docs/RUNBOOK.md §pgvector for per-provider enablement.',
    SQLSTATE, SQLERRM;
END
$$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
  RAISE NOTICE 'postgis extension installed (or already present).';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'postgis extension NOT available on this server (SQLSTATE=%, message=%). '
    'core_entity.geo_geog will be created as JSONB fallback if the column '
    'type fails below. Geo-search will be unavailable until the operator '
    'enables PostGIS at the server level.',
    SQLSTATE, SQLERRM;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Create core_entity table.
--
--    `entity_type` is a text FK into `entity_type_definition` (created
--    in 0187 immediately after this migration applies). We declare the
--    column here WITHOUT the FK constraint and add it in 0187 to keep
--    the migration ordering clean and avoid forward references.
--
--    `parent_entity_id` self-references for subdivisions (LAND_PARCEL →
--    LAND_PARCEL, BUILDING → SUB_UNIT, etc.). ON DELETE CASCADE so
--    deleting a parent recursively removes its children.
--
--    `geo_geog` uses PostGIS geography(GEOMETRY, 4326). If PostGIS is
--    not available, the CREATE TABLE will fail — we wrap the table
--    creation in a DO block with a JSONB fallback so dev environments
--    without PostGIS still apply.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  postgis_available boolean;
BEGIN
  postgis_available := EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'postgis'
  );

  IF postgis_available THEN
    EXECUTE $ddl$
      CREATE TABLE IF NOT EXISTS core_entity (
        id                       TEXT PRIMARY KEY,
        tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        module_id                TEXT,
        entity_type              TEXT NOT NULL,
        parent_entity_id         TEXT REFERENCES core_entity(id) ON DELETE CASCADE,
        discriminator            TEXT,
        display_name             TEXT NOT NULL,
        lifecycle_state          TEXT NOT NULL DEFAULT 'active',
        geo_geog                 geography(GEOMETRY, 4326),
        custom_fields            JSONB NOT NULL DEFAULT '{}'::jsonb,
        embedding                vector(1536),
        tsv                      tsvector,
        audit_chain_root_hash    TEXT,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by               TEXT,
        deleted_at               TIMESTAMPTZ
      )
    $ddl$;
  ELSE
    EXECUTE $ddl$
      CREATE TABLE IF NOT EXISTS core_entity (
        id                       TEXT PRIMARY KEY,
        tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        module_id                TEXT,
        entity_type              TEXT NOT NULL,
        parent_entity_id         TEXT REFERENCES core_entity(id) ON DELETE CASCADE,
        discriminator            TEXT,
        display_name             TEXT NOT NULL,
        lifecycle_state          TEXT NOT NULL DEFAULT 'active',
        geo_geog                 JSONB,
        custom_fields            JSONB NOT NULL DEFAULT '{}'::jsonb,
        embedding                vector(1536),
        tsv                      tsvector,
        audit_chain_root_hash    TEXT,
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by               TEXT,
        deleted_at               TIMESTAMPTZ
      )
    $ddl$;
    RAISE NOTICE 'core_entity created with JSONB geo_geog fallback (PostGIS unavailable).';
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- Last-resort retry without geo_geog typing if even vector typing failed.
  RAISE NOTICE
    'core_entity strict create failed (SQLSTATE=%, message=%); '
    'retrying with permissive fallback (JSONB geo_geog, TEXT embedding).',
    SQLSTATE, SQLERRM;
  EXECUTE $ddl$
    CREATE TABLE IF NOT EXISTS core_entity (
      id                       TEXT PRIMARY KEY,
      tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_id                TEXT,
      entity_type              TEXT NOT NULL,
      parent_entity_id         TEXT REFERENCES core_entity(id) ON DELETE CASCADE,
      discriminator            TEXT,
      display_name             TEXT NOT NULL,
      lifecycle_state          TEXT NOT NULL DEFAULT 'active',
      geo_geog                 JSONB,
      custom_fields            JSONB NOT NULL DEFAULT '{}'::jsonb,
      embedding                TEXT,
      tsv                      tsvector,
      audit_chain_root_hash    TEXT,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by               TEXT,
      deleted_at               TIMESTAMPTZ
    )
  $ddl$;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Indexes — tenant-partial (deleted_at IS NULL), parent navigation,
--    geo (GIST when PostGIS available), tsvector GIN, embedding HNSW,
--    custom_fields JSONB GIN.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS core_entity_tenant_idx
  ON core_entity (tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS core_entity_type_idx
  ON core_entity (tenant_id, entity_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS core_entity_parent_idx
  ON core_entity (parent_entity_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS core_entity_lifecycle_idx
  ON core_entity (tenant_id, lifecycle_state)
  WHERE deleted_at IS NULL;

-- GIST index requires PostGIS; guard with DO block.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    -- Only create the GIST index if the column type is actually geography.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'core_entity'
        AND column_name = 'geo_geog'
        AND udt_name = 'geography'
    ) THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS core_entity_geo_idx '
              'ON core_entity USING GIST (geo_geog)';
    END IF;
  END IF;
END
$$;

-- BM25-style hybrid retrieval — tsvector GIN.
CREATE INDEX IF NOT EXISTS core_entity_tsv_idx
  ON core_entity USING GIN (tsv);

-- Dense retrieval — HNSW on the embedding column (pgvector ≥0.5).
-- Falls back to no index when vector extension is unavailable.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'core_entity'
        AND column_name = 'embedding'
        AND udt_name = 'vector'
    ) THEN
      BEGIN
        EXECUTE 'CREATE INDEX IF NOT EXISTS core_entity_embedding_idx '
                'ON core_entity USING hnsw (embedding vector_cosine_ops)';
      EXCEPTION WHEN OTHERS THEN
        -- pgvector < 0.5 has no HNSW; fall back to IVFFlat with low lists.
        BEGIN
          EXECUTE 'CREATE INDEX IF NOT EXISTS core_entity_embedding_idx '
                  'ON core_entity USING ivfflat (embedding vector_cosine_ops) '
                  'WITH (lists = 100)';
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'embedding index creation failed (SQLSTATE=%); '
                       'ANN search will fall back to seq-scan.', SQLSTATE;
        END;
      END;
    END IF;
  END IF;
END
$$;

-- Custom fields JSONB GIN (jsonb_path_ops — smaller index, faster
-- @> contains operator). Powers any `WHERE custom_fields @> '{...}'`.
CREATE INDEX IF NOT EXISTS core_entity_custom_fields_idx
  ON core_entity USING GIN (custom_fields jsonb_path_ops);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. tsvector update trigger — keeps `tsv` synced with display_name +
--    discriminator + custom_fields whenever a row is inserted/updated.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.core_entity_tsv_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.display_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.discriminator, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.entity_type, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.custom_fields::text, '')), 'C');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS core_entity_tsv_trigger ON core_entity;
CREATE TRIGGER core_entity_tsv_trigger
  BEFORE INSERT OR UPDATE OF display_name, discriminator, entity_type, custom_fields
  ON core_entity
  FOR EACH ROW
  EXECUTE FUNCTION public.core_entity_tsv_update();

COMMENT ON FUNCTION public.core_entity_tsv_update IS
  'Maintains core_entity.tsv from (display_name, discriminator, entity_type, '
  'custom_fields) on every insert/update. Weighted A>B>C for ranking. '
  'simple config so language-agnostic stemming (Swahili / Kiluo / etc. '
  'tolerated without special dictionaries).';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Gold-standard RLS pattern (matches 0182 / 0183 / 0184 / 0185).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'core_entity'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Documentation.
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE core_entity IS
  'Piece A universal asset & entity model — polymorphic root for land, '
  'buildings, sub-units, vehicles, machinery, IT, intangibles, people. '
  'Tenant-scoped via RLS (gold-standard pattern). Subdivision via '
  'parent_entity_id self-reference. Hybrid retrieval: BM25 (tsv) + '
  'dense (embedding) + geo (geo_geog) + jsonb (custom_fields).';

COMMENT ON COLUMN core_entity.module_id IS
  'NULL during Wave 16 rollout; required after Piece B (Module Registry) '
  'lands. Indicates which @borjie module owns this entity.';

COMMENT ON COLUMN core_entity.entity_type IS
  'FK into entity_type_definition.slug (constraint added in 0187). '
  'Drives which entity_ext_* table holds the type-specific columns.';

COMMENT ON COLUMN core_entity.parent_entity_id IS
  'Self-reference for subdivisions: LAND_PARCEL → LAND_PARCEL (sub-parcel), '
  'BUILDING → SUB_UNIT (room/suite), VEHICLE → none. ON DELETE CASCADE.';

COMMENT ON COLUMN core_entity.discriminator IS
  'Secondary classification within entity_type (e.g. "warehouse" within '
  '"BUILDING", "locomotive" within "VEHICLE"). Free-form TEXT for forward-'
  'compat; surfaced by the Mr. Mwikila brain as a hint.';

COMMENT ON COLUMN core_entity.geo_geog IS
  'PostGIS geography(GEOMETRY, 4326) when available — point/line/polygon. '
  'JSONB fallback on PostGIS-less environments. Powers spatial search and '
  'subdivision area calculations.';

COMMENT ON COLUMN core_entity.custom_fields IS
  'Tenant-defined fields validated against tenant_schema_extensions (0188). '
  'JSONB with jsonb_path_ops GIN index. NEVER stores money — use the '
  'payments-ledger LedgerService.post() path for that.';

COMMENT ON COLUMN core_entity.embedding IS
  '1536-dim dense vector (OpenAI text-embedding-3-small or equivalent). '
  'Indexed via HNSW (cosine). Powers semantic search. Populated by the '
  'consolidation worker; written nullable so direct inserts do not block.';

COMMENT ON COLUMN core_entity.tsv IS
  'BM25-style tsvector maintained by core_entity_tsv_trigger. Hybrid '
  'rerank: BM25 score * α + dense cosine * β + geo distance * γ.';

COMMENT ON COLUMN core_entity.audit_chain_root_hash IS
  'Optional anchor into ai_audit_chain — for entities created via a '
  'sovereign / four-eye action, this is the root_hash of the chain '
  'segment that authorised the create.';
