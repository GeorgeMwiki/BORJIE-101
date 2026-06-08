-- =============================================================================
-- Migration 0306 — CREATE the core_entity family (Piece A universal asset &
-- entity model) that the runtime queries but that had NO applied CREATE
-- migration. The DDL only existed in packages/database/.archive/migrations/
-- (0186..0194); the in-tree src/migrations chain never created these tables,
-- so a freshly-migrated production DB throws
--   'relation "core_entity" does not exist'
-- the first time core-entity.repository.ts runs (insert at L219, entity_ext_*
-- inserts at L234-271, reads at L298+). This is the #1 deploy blocker.
--
-- PROVENANCE: the 10 tables below are the ones queried at runtime via
-- packages/database/src/repositories/core-entity.repository.ts (the typed
-- Drizzle reads/writes wired in
-- services/api-gateway/src/composition/dispatch-handler-deps-wiring.ts). Each
-- table's DDL is reconciled COLUMN-FOR-COLUMN against the live Drizzle
-- schema (packages/database/src/schemas/core-entity/*.schema.ts), which is the
-- source of truth — the archive 0186..0194 originals are kept as a cross-check
-- but the Drizzle defs win where they differ (e.g. the archive's idempotent
-- entity_type_definition surrogate-PK dance is collapsed here because the
-- Drizzle schema declares `id TEXT PRIMARY KEY` directly).
--
-- RLS (CLAUDE.md hard rule — FORCE on every tenant-scoped table): the CANONICAL
-- pattern in this repo is `current_setting('app.current_tenant_id', true)` with
-- both ENABLE and FORCE ROW LEVEL SECURITY (see migration 0297, which repointed
-- the entire codebase OFF the legacy `public.current_app_tenant_id()` /
-- `app.tenant_id` GUC that the archive 0186..0194 originals used — that GUC is
-- never bound by the api-gateway request connection, so a policy reading it is
-- silently fail-closed). The api-gateway binds ONLY `app.current_tenant_id`
-- (services/api-gateway/src/middleware/database.ts). The two platform-shared
-- catalogs (entity_type_definition, tenant_schema_extensions) keep the
-- `tenant_id IS NULL OR tenant_id = guc` shape so platform built-in rows stay
-- globally visible; everything else is strict `tenant_id = guc`.
--
-- POSTGIS / PGVECTOR: core_entity.geo_geog is geography(GEOMETRY,4326) and
-- core_entity.embedding is vector(1536). Both are NULLABLE. They are added via
-- guarded DO-blocks that fall back to JSONB / TEXT when the extension is not
-- installed, so the migration applies on PostGIS-less / pgvector-less servers.
-- No NOT NULL column is ever created inside an EXECUTE block, so this file does
-- NOT need the `-- @safety: dynamic-not-null-reviewed` allowlist comment.
--
-- IDEMPOTENT / FRESH-DB SAFE: every statement is CREATE ... IF NOT EXISTS or a
-- guarded DO-block (pg_extension / information_schema.columns / pg_policies /
-- pg_trigger). Re-running is a no-op; applying on a fresh DB after the drizzle
-- baseline (which creates `tenants` + `users`) succeeds.
--
-- Companion lane decision (modules family + bare sessions): see the
-- borjie-db-drift lane notes. modules / module_specs / module_templates /
-- module_accept_handlers and the bare `sessions` table are NOT created here —
-- they have ZERO runtime Drizzle I/O (no .insert/.from/.update/.delete; the
-- ModulesStorePort has no concrete Drizzle-backed impl and createModulesRouter
-- is never mounted; the orchestrator is "purely deterministic, no DB"). Their
-- false drift is removed by deleting the orphan Drizzle defs + barrel exports
-- in the same lane.
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Extensions (idempotent + fail-soft). vector powers ANN search on
--    core_entity.embedding; postgis powers geo on core_entity.geo_geog.
--    Failure to install is non-fatal: the columns below degrade to a
--    permissive fallback type and stay NULLable so writes still succeed.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector not available (SQLSTATE=%); core_entity.embedding falls back to TEXT.', SQLSTATE;
END $$;

DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS postgis;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'postgis not available (SQLSTATE=%); core_entity.geo_geog falls back to JSONB.', SQLSTATE;
END $$;

-- ---------------------------------------------------------------------------
-- 1. core_entity — polymorphic root. (matches core-entity.schema.ts)
--    Base columns only here; geo_geog / embedding / tsv are added via guarded
--    DO-blocks below so the extension-typed columns are conditional.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "core_entity" (
  "id"                    text PRIMARY KEY NOT NULL,
  "tenant_id"             text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "module_id"             text,
  "entity_type"           text NOT NULL,
  "parent_entity_id"      text REFERENCES "core_entity"("id") ON DELETE CASCADE,
  "discriminator"         text,
  "display_name"          text NOT NULL,
  "lifecycle_state"       text DEFAULT 'active' NOT NULL,
  "custom_fields"         jsonb DEFAULT '{}'::jsonb NOT NULL,
  "audit_chain_root_hash" text,
  "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"            timestamp with time zone DEFAULT now() NOT NULL,
  "created_by"            text,
  "deleted_at"            timestamp with time zone
);

-- geo_geog: geography(GEOMETRY,4326) when PostGIS present, else JSONB. NULLABLE.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_entity' AND column_name = 'geo_geog'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
      EXECUTE 'ALTER TABLE "core_entity" ADD COLUMN "geo_geog" geography(GEOMETRY, 4326)';
    ELSE
      EXECUTE 'ALTER TABLE "core_entity" ADD COLUMN "geo_geog" jsonb';
    END IF;
  END IF;
END $$;

-- embedding: vector(1536) when pgvector present, else TEXT. NULLABLE.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'core_entity' AND column_name = 'embedding'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
      EXECUTE 'ALTER TABLE "core_entity" ADD COLUMN "embedding" vector(1536)';
    ELSE
      EXECUTE 'ALTER TABLE "core_entity" ADD COLUMN "embedding" text';
    END IF;
  END IF;
END $$;

-- tsv: tsvector, maintained by the trigger below. NULLABLE.
ALTER TABLE "core_entity" ADD COLUMN IF NOT EXISTS "tsv" tsvector;

-- Indexes (partial on deleted_at IS NULL where the schema/archive expect it).
CREATE INDEX IF NOT EXISTS "core_entity_tenant_idx"        ON "core_entity" ("tenant_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "core_entity_type_idx"          ON "core_entity" ("tenant_id", "entity_type") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "core_entity_parent_idx"        ON "core_entity" ("parent_entity_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "core_entity_lifecycle_idx"     ON "core_entity" ("tenant_id", "lifecycle_state") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "core_entity_tsv_idx"           ON "core_entity" USING GIN ("tsv");
CREATE INDEX IF NOT EXISTS "core_entity_custom_fields_idx" ON "core_entity" USING GIN ("custom_fields" jsonb_path_ops);

-- GIST geo index — only when geo_geog is a real geography column.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'core_entity' AND column_name = 'geo_geog' AND udt_name = 'geography'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "core_entity_geo_idx" ON "core_entity" USING GIST ("geo_geog")';
  END IF;
END $$;

-- HNSW (cosine) embedding index — only when embedding is a real vector column.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'core_entity' AND column_name = 'embedding' AND udt_name = 'vector'
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS "core_entity_embedding_idx" ON "core_entity" USING hnsw ("embedding" vector_cosine_ops)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'core_entity HNSW index creation skipped (SQLSTATE=%); ANN falls back to seq-scan.', SQLSTATE;
    END;
  END IF;
END $$;

-- tsvector maintenance trigger — keeps tsv synced (weighted A>B>C).
CREATE OR REPLACE FUNCTION public.core_entity_tsv_update()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.display_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.discriminator, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.entity_type, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.custom_fields::text, '')), 'C');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS core_entity_tsv_trigger ON "core_entity";
CREATE TRIGGER core_entity_tsv_trigger
  BEFORE INSERT OR UPDATE OF display_name, discriminator, entity_type, custom_fields
  ON "core_entity"
  FOR EACH ROW EXECUTE FUNCTION public.core_entity_tsv_update();

-- ---------------------------------------------------------------------------
-- 2. entity_type_definition — type catalog. (matches entity-type.schema.ts)
--    Drizzle declares `id TEXT PRIMARY KEY` directly + two partial unique
--    indexes for (slug | platform) and (tenant_id, slug | tenant). Seeds the
--    17 platform built-ins so the entity_type check-trigger can accept them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "entity_type_definition" (
  "id"                   text PRIMARY KEY NOT NULL,
  "slug"                 text NOT NULL,
  "tenant_id"            text REFERENCES "tenants"("id") ON DELETE CASCADE,
  "display_name_en"      text NOT NULL,
  "display_name_sw"      text,
  "description"          text,
  "is_built_in"          boolean DEFAULT false NOT NULL,
  "allowed_parent_types" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "icon"                 text,
  "created_at"           timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "entity_type_definition_platform_slug_uidx" ON "entity_type_definition" ("slug") WHERE "tenant_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "entity_type_definition_tenant_slug_uidx"   ON "entity_type_definition" ("tenant_id", "slug") WHERE "tenant_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "entity_type_definition_tenant_idx"  ON "entity_type_definition" ("tenant_id");
CREATE INDEX IF NOT EXISTS "entity_type_definition_built_in_idx" ON "entity_type_definition" ("is_built_in") WHERE "is_built_in" = TRUE;

INSERT INTO "entity_type_definition" (id, slug, tenant_id, display_name_en, display_name_sw, is_built_in, allowed_parent_types, icon) VALUES
  ('LAND_PARCEL:__platform__','LAND_PARCEL', NULL, 'Land Parcel','Kipande cha Ardhi', TRUE, ARRAY['LAND_PARCEL']::text[], 'land'),
  ('BUILDING:__platform__','BUILDING', NULL, 'Building','Jengo', TRUE, ARRAY['LAND_PARCEL']::text[], 'building'),
  ('SUB_UNIT:__platform__','SUB_UNIT', NULL, 'Sub-Unit','Chumba', TRUE, ARRAY['BUILDING']::text[], 'door'),
  ('WAREHOUSE:__platform__','WAREHOUSE', NULL, 'Warehouse','Bohari', TRUE, ARRAY['LAND_PARCEL']::text[], 'warehouse'),
  ('GODOWN:__platform__','GODOWN', NULL, 'Godown','Ghala', TRUE, ARRAY['LAND_PARCEL']::text[], 'godown'),
  ('HOTEL:__platform__','HOTEL', NULL, 'Hotel','Hoteli', TRUE, ARRAY['LAND_PARCEL']::text[], 'hotel'),
  ('PLOT:__platform__','PLOT', NULL, 'Plot','Kiwanja', TRUE, ARRAY['LAND_PARCEL']::text[], 'plot'),
  ('BARELAND:__platform__','BARELAND', NULL, 'Bareland','Ardhi Tupu', TRUE, ARRAY['LAND_PARCEL']::text[], 'bareland'),
  ('VEHICLE:__platform__','VEHICLE', NULL, 'Vehicle','Gari', TRUE, ARRAY[]::text[], 'vehicle'),
  ('LOCOMOTIVE:__platform__','LOCOMOTIVE', NULL, 'Locomotive','Loko', TRUE, ARRAY[]::text[], 'locomotive'),
  ('MACHINERY:__platform__','MACHINERY', NULL, 'Machinery','Mashine', TRUE, ARRAY['BUILDING','LAND_PARCEL']::text[], 'gear'),
  ('IT_ASSET:__platform__','IT_ASSET', NULL, 'IT Asset','Vifaa vya Teknolojia', TRUE, ARRAY[]::text[], 'laptop'),
  ('INTANGIBLE:__platform__','INTANGIBLE', NULL, 'Intangible Asset','Mali Isiyoonekana', TRUE, ARRAY[]::text[], 'document'),
  ('PERSON:__platform__','PERSON', NULL, 'Person','Mtu', TRUE, ARRAY['ORG_UNIT']::text[], 'person'),
  ('ORG_UNIT:__platform__','ORG_UNIT', NULL, 'Organizational Unit','Kitengo cha Shirika', TRUE, ARRAY['ORG_UNIT']::text[], 'team'),
  ('VENDOR:__platform__','VENDOR', NULL, 'Vendor','Muuzaji', TRUE, ARRAY[]::text[], 'vendor'),
  ('CONTRACT:__platform__','CONTRACT', NULL, 'Contract','Mkataba', TRUE, ARRAY[]::text[], 'contract')
ON CONFLICT DO NOTHING;

-- entity_type validation trigger — lighter than a true FK (the slug spans two
-- partial unique indexes). Accepts platform built-ins (tenant_id IS NULL) and
-- the row's own tenant types.
CREATE OR REPLACE FUNCTION public.core_entity_type_check()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "entity_type_definition"
    WHERE slug = NEW.entity_type
      AND (tenant_id IS NULL OR tenant_id = NEW.tenant_id)
  ) THEN
    RAISE EXCEPTION 'entity_type %, not found in entity_type_definition for tenant %',
      NEW.entity_type, NEW.tenant_id USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS core_entity_type_check_trigger ON "core_entity";
CREATE TRIGGER core_entity_type_check_trigger
  BEFORE INSERT OR UPDATE OF entity_type, tenant_id
  ON "core_entity"
  FOR EACH ROW EXECUTE FUNCTION public.core_entity_type_check();

-- ---------------------------------------------------------------------------
-- 3. tenant_schema_extensions — custom-field catalog.
--    (matches tenant-schema-extensions.schema.ts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tenant_schema_extensions" (
  "id"                text PRIMARY KEY NOT NULL,
  "tenant_id"         text REFERENCES "tenants"("id") ON DELETE CASCADE,
  "module_id"         text,
  "entity_type"       text NOT NULL,
  "field_name"        text NOT NULL,
  "field_kind"        text NOT NULL,
  "zod_jsonb"         jsonb NOT NULL,
  "required"          boolean DEFAULT false NOT NULL,
  "index_strategy"    text,
  "validations_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "display_order"     integer,
  "display_label_en"  text,
  "display_label_sw"  text,
  "help_text"         text,
  "placeholder"       text,
  "deleted_at"        timestamp with time zone,
  "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"        timestamp with time zone DEFAULT now() NOT NULL,
  "created_by"        text
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_schema_extensions_uidx" ON "tenant_schema_extensions" (
  COALESCE("tenant_id", '__platform__'),
  COALESCE("module_id", '__no_module__'),
  "entity_type",
  "field_name"
) WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "tenant_schema_extensions_tenant_idx" ON "tenant_schema_extensions" ("tenant_id") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "tenant_schema_extensions_type_idx"   ON "tenant_schema_extensions" ("tenant_id", "entity_type") WHERE "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. entity_ext_land — (matches entity-ext-land.schema.ts + archive 0189)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "entity_ext_land" (
  "entity_id"          text PRIMARY KEY REFERENCES "core_entity"("id") ON DELETE CASCADE,
  "tenant_id"          text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "plot_number"        text,
  "hectares"           numeric(12, 4),
  "fractional_area"    numeric(6, 4),
  "in_railway_reserve" boolean DEFAULT false NOT NULL,
  "zoning"             text,
  "land_use"           text,
  "title_deed_ref"     text,
  "surveyed_at"        date,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"         timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "entity_ext_land_tenant_idx" ON "entity_ext_land" ("tenant_id");
CREATE INDEX IF NOT EXISTS "entity_ext_land_zoning_idx" ON "entity_ext_land" ("tenant_id", "zoning");
CREATE INDEX IF NOT EXISTS "entity_ext_land_railway_reserve_idx" ON "entity_ext_land" ("tenant_id") WHERE "in_railway_reserve" = TRUE;
CREATE INDEX IF NOT EXISTS "entity_ext_land_plot_number_idx" ON "entity_ext_land" ("tenant_id", "plot_number") WHERE "plot_number" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. entity_ext_building — (matches entity-ext-building.schema.ts + archive 0190)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "entity_ext_building" (
  "entity_id"          text PRIMARY KEY REFERENCES "core_entity"("id") ON DELETE CASCADE,
  "tenant_id"          text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "building_type"      text NOT NULL,
  "floors"             smallint,
  "square_meters"      numeric(12, 2),
  "year_built"         smallint,
  "condition_rating"   smallint,
  "last_inspection_at" date,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"         timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "entity_ext_building_tenant_idx" ON "entity_ext_building" ("tenant_id");
CREATE INDEX IF NOT EXISTS "entity_ext_building_type_idx"   ON "entity_ext_building" ("tenant_id", "building_type");

-- ---------------------------------------------------------------------------
-- 6. entity_ext_vehicle — (matches entity-ext-vehicle.schema.ts + archive 0191)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "entity_ext_vehicle" (
  "entity_id"         text PRIMARY KEY REFERENCES "core_entity"("id") ON DELETE CASCADE,
  "tenant_id"         text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "vin"               text,
  "license_plate"     text,
  "make"              text,
  "model"             text,
  "year_manufactured" smallint,
  "fuel_type"         text,
  "odometer_km"       integer,
  "status"            text DEFAULT 'active' NOT NULL,
  "last_service_at"   date,
  "created_at"        timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"        timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "entity_ext_vehicle_tenant_idx" ON "entity_ext_vehicle" ("tenant_id");
CREATE INDEX IF NOT EXISTS "entity_ext_vehicle_status_idx" ON "entity_ext_vehicle" ("tenant_id", "status");

-- ---------------------------------------------------------------------------
-- 7. entity_ext_machinery — (matches entity-ext-machinery.schema.ts + archive 0192)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "entity_ext_machinery" (
  "entity_id"          text PRIMARY KEY REFERENCES "core_entity"("id") ON DELETE CASCADE,
  "tenant_id"          text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "serial_number"      text,
  "manufacturer"       text,
  "model"              text,
  "installation_date"  date,
  "warranty_expires"   date,
  "last_inspection_at" date,
  "hours_run"          integer,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"         timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "entity_ext_machinery_tenant_idx"       ON "entity_ext_machinery" ("tenant_id");
CREATE INDEX IF NOT EXISTS "entity_ext_machinery_manufacturer_idx" ON "entity_ext_machinery" ("tenant_id", "manufacturer");

-- ---------------------------------------------------------------------------
-- 8. entity_ext_it_asset — (matches entity-ext-it-asset.schema.ts + archive 0193)
--    assigned_to_entity_id is a core_entity FK ON DELETE SET NULL (the archive
--    DDL declares the FK; the Drizzle col is bare text — FK kept for integrity).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "entity_ext_it_asset" (
  "entity_id"             text PRIMARY KEY REFERENCES "core_entity"("id") ON DELETE CASCADE,
  "tenant_id"             text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "asset_tag"             text,
  "device_kind"           text,
  "manufacturer"          text,
  "model"                 text,
  "purchase_date"         date,
  "assigned_to_entity_id" text REFERENCES "core_entity"("id") ON DELETE SET NULL,
  "status"                text DEFAULT 'active' NOT NULL,
  "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"            timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "entity_ext_it_asset_tenant_idx"   ON "entity_ext_it_asset" ("tenant_id");
CREATE INDEX IF NOT EXISTS "entity_ext_it_asset_assigned_idx" ON "entity_ext_it_asset" ("assigned_to_entity_id") WHERE "assigned_to_entity_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "entity_ext_it_asset_status_idx"   ON "entity_ext_it_asset" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "entity_ext_it_asset_kind_idx"     ON "entity_ext_it_asset" ("tenant_id", "device_kind");
CREATE UNIQUE INDEX IF NOT EXISTS "entity_ext_it_asset_tag_uidx" ON "entity_ext_it_asset" ("tenant_id", "asset_tag") WHERE "asset_tag" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 9. entity_ext_person — (matches entity-ext-person.schema.ts + archive 0194)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "entity_ext_person" (
  "entity_id"          text PRIMARY KEY REFERENCES "core_entity"("id") ON DELETE CASCADE,
  "tenant_id"          text NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "supabase_user_id"   text,
  "email"              text,
  "phone"              text,
  "nida_number"        text,
  "first_name"         text,
  "last_name"          text,
  "preferred_language" text DEFAULT 'en' NOT NULL,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"         timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "entity_ext_person_tenant_idx"   ON "entity_ext_person" ("tenant_id");
CREATE INDEX IF NOT EXISTS "entity_ext_person_supabase_idx" ON "entity_ext_person" ("supabase_user_id");

-- ---------------------------------------------------------------------------
-- 10. RLS — canonical pattern: ENABLE + FORCE + current_setting GUC.
--     Strict tenant isolation for core_entity + the 6 entity_ext_* tables.
--     entity_type_definition + tenant_schema_extensions keep the platform
--     carve-out (tenant_id IS NULL rows globally readable).
-- ---------------------------------------------------------------------------

-- Strict tenant_id = guc (core_entity + 6 extension tables).
DO $$
DECLARE
  tbl text;
  strict_tables text[] := ARRAY[
    'core_entity',
    'entity_ext_land',
    'entity_ext_building',
    'entity_ext_vehicle',
    'entity_ext_machinery',
    'entity_ext_it_asset',
    'entity_ext_person'
  ];
BEGIN
  FOREACH tbl IN ARRAY strict_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_tenant_isolation', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL '
      'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
      'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
      tbl || '_tenant_isolation', tbl
    );
    -- REVOKE anon defence-in-depth, guarded for vanilla PG where the
    -- Supabase `anon` role does not exist. Inline-guarded (NOT a block-level
    -- EXCEPTION) so a missing role never rolls back the ENABLE/FORCE/POLICY.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

-- Platform-carve-out catalogs (entity_type_definition, tenant_schema_extensions):
-- platform rows (tenant_id IS NULL) globally readable; writes scoped to tenant.
DO $$
DECLARE
  tbl text;
  catalog_tables text[] := ARRAY[
    'entity_type_definition',
    'tenant_schema_extensions'
  ];
BEGIN
  FOREACH tbl IN ARRAY catalog_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_select', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', tbl || '_modify', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT '
      'USING (tenant_id IS NULL OR tenant_id = current_setting(''app.current_tenant_id'', true));',
      tbl || '_select', tbl
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL '
      'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
      'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
      tbl || '_modify', tbl
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
