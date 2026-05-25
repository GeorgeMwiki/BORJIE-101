-- =============================================================================
-- 0216: Fix Piece A entity_type_definition + unify Piece K with legacy documents
--
-- Closes three migration application failures observed in the May-2026 cutover:
--
-- 1. `0187_entity_type_definition.sql` used an invalid PRIMARY KEY expression
--    (`PRIMARY KEY (slug, COALESCE(tenant_id, ''))`). Postgres does not allow
--    function calls in PK column lists. Rewritten here with PK on `id` and a
--    NULLS-NOT-DISTINCT UNIQUE constraint on (slug, tenant_id).
--
-- 2. `0211_documents.sql` collided with the legacy `documents` table
--    (file-attachment store from earlier waves). Piece K's intent — track OCR
--    + processing-state — is layered onto the legacy table via ALTER TABLE
--    ADD COLUMN IF NOT EXISTS.
--
-- 3. `0213_document_entities.sql` collided with the legacy `document_entities`
--    table (raw NER entities, different shape). Piece K's resolution-layer
--    intent is delivered via a NEW `document_entity_resolutions` table that
--    links a document extraction to a canonical `core_entity` row.
--
-- 4. `0215_document_entities_core_entity_fk.sql` fell out for the same reason
--    as #3; the FK now lives on `document_entity_resolutions.resolved_entity_id`.
--
-- All new structures FORCE RLS by `app.current_tenant_id` GUC.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. entity_type_definition — Piece A's missing type catalog
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_type_definition (
  id                    text PRIMARY KEY,
  slug                  text NOT NULL,
  tenant_id             text REFERENCES tenants(id) ON DELETE CASCADE,
  display_name_en       text NOT NULL,
  display_name_sw       text,
  description           text,
  is_built_in           boolean NOT NULL DEFAULT false,
  allowed_parent_types  text[],
  icon                  text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Slug+tenant_id is naturally unique (built-ins have tenant_id NULL; tenant
-- types carry a tenant_id). NULLS NOT DISTINCT makes the constraint work
-- correctly across built-ins.
CREATE UNIQUE INDEX IF NOT EXISTS entity_type_definition_slug_tenant_uniq
  ON entity_type_definition (slug, COALESCE(tenant_id, '__platform__'));

CREATE INDEX IF NOT EXISTS entity_type_definition_tenant_idx
  ON entity_type_definition (tenant_id) WHERE tenant_id IS NOT NULL;

ALTER TABLE entity_type_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_type_definition FORCE ROW LEVEL SECURITY;

-- Platform built-ins are visible to all tenants; tenant-defined types
-- visible only to their owning tenant.
DROP POLICY IF EXISTS entity_type_definition_select ON entity_type_definition;
CREATE POLICY entity_type_definition_select
  ON entity_type_definition FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS entity_type_definition_modify ON entity_type_definition;
CREATE POLICY entity_type_definition_modify
  ON entity_type_definition FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

REVOKE ALL ON entity_type_definition FROM anon;
GRANT SELECT ON entity_type_definition TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_type_definition TO service_role;

-- Seed 17 built-in entity types (matches Piece A spec).
INSERT INTO entity_type_definition (id, slug, is_built_in, display_name_en, display_name_sw, description, allowed_parent_types, icon)
VALUES
  ('et_land_parcel',  'LAND_PARCEL',  true, 'Land Parcel',          'Kipande cha Ardhi',     'Tract of land, surveyed or unsurveyed',                ARRAY['LAND_PARCEL']::text[],                       'map'),
  ('et_building',     'BUILDING',     true, 'Building',             'Jengo',                 'Built structure (warehouse, hotel, office, etc.)',     ARRAY['LAND_PARCEL']::text[],                       'building'),
  ('et_sub_unit',     'SUB_UNIT',     true, 'Sub-Unit',             'Chumba Cha Kupanga',   'Subdivision of a building or land parcel',             ARRAY['BUILDING','LAND_PARCEL','SUB_UNIT']::text[], 'door-open'),
  ('et_warehouse',    'WAREHOUSE',    true, 'Warehouse',            'Ghala',                 'Storage warehouse',                                    ARRAY['LAND_PARCEL','BUILDING']::text[],            'package'),
  ('et_godown',       'GODOWN',       true, 'Godown',               'Banda La Akiba',       'Open or covered storage area',                         ARRAY['LAND_PARCEL','BUILDING']::text[],            'truck'),
  ('et_hotel',        'HOTEL',        true, 'Hotel',                'Hoteli',                'Hotel or lodging operation',                           ARRAY['LAND_PARCEL','BUILDING']::text[],            'bed'),
  ('et_plot',         'PLOT',         true, 'Plot',                 'Kiwanja',               'Individual plot of land',                              ARRAY['LAND_PARCEL']::text[],                       'grid'),
  ('et_bareland',     'BARELAND',     true, 'Bareland',             'Ardhi Wazi',           'Undeveloped land',                                     ARRAY['LAND_PARCEL']::text[],                       'mountain'),
  ('et_vehicle',      'VEHICLE',      true, 'Vehicle',              'Gari',                  'Road vehicle (car, truck, etc.)',                      NULL,                                                'car'),
  ('et_locomotive',   'LOCOMOTIVE',   true, 'Locomotive',           'Locomoti',              'Rail locomotive',                                      NULL,                                                'train'),
  ('et_machinery',    'MACHINERY',    true, 'Machinery',            'Mashine',               'Heavy machinery / equipment',                          NULL,                                                'cog'),
  ('et_it_asset',     'IT_ASSET',     true, 'IT Asset',             'Mali Ya IT',           'Computer, server, network device, mobile',             NULL,                                                'monitor'),
  ('et_intangible',   'INTANGIBLE',   true, 'Intangible Asset',     'Mali Isiyo Halisi',    'License, trademark, contract right',                   NULL,                                                'file-text'),
  ('et_person',       'PERSON',       true, 'Person',               'Mtu',                   'Individual (employee, customer, vendor contact)',      NULL,                                                'user'),
  ('et_org_unit',     'ORG_UNIT',     true, 'Organizational Unit',  'Kitengo Cha Shirika',  'Department, district, region within a tenant',         ARRAY['ORG_UNIT']::text[],                          'sitemap'),
  ('et_vendor',       'VENDOR',       true, 'Vendor',               'Mzabuni',               'External vendor or contractor',                        NULL,                                                'briefcase'),
  ('et_contract',     'CONTRACT',     true, 'Contract',             'Mkataba',               'Formal contract',                                      NULL,                                                'file-signature')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE  entity_type_definition IS 'Piece A — polymorphic entity type catalog. Platform built-ins (tenant_id NULL) + tenant-defined types.';
COMMENT ON COLUMN entity_type_definition.slug IS 'Stable slug used by core_entity.entity_type FK reference.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill core_entity.entity_type → entity_type_definition.slug FK (was
--    deferred because the table did not exist when 0186 ran).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'core_entity'
      AND constraint_name = 'core_entity_entity_type_fkey'
  ) THEN
    -- Soft-skip if a row exists with an unknown entity_type (would block FK creation).
    IF NOT EXISTS (
      SELECT 1 FROM core_entity ce
      WHERE NOT EXISTS (
        SELECT 1 FROM entity_type_definition etd WHERE etd.slug = ce.entity_type
      )
    ) THEN
      ALTER TABLE core_entity
        ADD CONSTRAINT core_entity_entity_type_fkey
        FOREIGN KEY (entity_type) REFERENCES entity_type_definition(slug);
    END IF;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Extend legacy `documents` with Piece K OCR / processing-state columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS sha256              text,
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id text REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS filename            text,
  ADD COLUMN IF NOT EXISTS page_count          integer,
  ADD COLUMN IF NOT EXISTS ocr_text            text,
  ADD COLUMN IF NOT EXISTS ocr_language        text,
  ADD COLUMN IF NOT EXISTS processing_state    text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_error    text,
  ADD COLUMN IF NOT EXISTS source_channel      text,
  ADD COLUMN IF NOT EXISTS related_thread_id   text;

-- Backfill filename from existing `name` if present (legacy column).
UPDATE documents SET filename = name WHERE filename IS NULL AND name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_sha256_uniq
  ON documents (tenant_id, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS documents_tenant_state_idx
  ON documents (tenant_id, processing_state);
CREATE INDEX IF NOT EXISTS documents_tenant_created_idx
  ON documents (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_thread_idx
  ON documents (related_thread_id) WHERE related_thread_id IS NOT NULL;

COMMENT ON COLUMN documents.sha256           IS 'Piece K — content-addressed dedupe.';
COMMENT ON COLUMN documents.ocr_text         IS 'Piece K — full extracted text (EN+SW).';
COMMENT ON COLUMN documents.processing_state IS 'Piece K — pending|ocr_done|parsed|extracted|routed|done|error.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Piece K entity-resolution layer — links a document extraction to a
--    canonical core_entity row. (The legacy `document_entities` is the NER
--    raw-entity layer with a different shape; both can coexist.)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_entity_resolutions (
  id                       text PRIMARY KEY,
  document_id              text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id                text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  extraction_id            text NOT NULL REFERENCES document_extractions(id) ON DELETE CASCADE,
  resolved_entity_id       text REFERENCES core_entity(id) ON DELETE SET NULL,
  resolution_confidence    numeric(5,4) NOT NULL,
  resolution_method        text NOT NULL,
  resolution_hitl_status   text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_entity_resolutions_tenant_idx
  ON document_entity_resolutions (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_entity_resolutions_resolved_idx
  ON document_entity_resolutions (resolved_entity_id) WHERE resolved_entity_id IS NOT NULL;

ALTER TABLE document_entity_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_entity_resolutions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_entity_resolutions_select ON document_entity_resolutions;
CREATE POLICY document_entity_resolutions_select
  ON document_entity_resolutions FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS document_entity_resolutions_modify ON document_entity_resolutions;
CREATE POLICY document_entity_resolutions_modify
  ON document_entity_resolutions FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

REVOKE ALL ON document_entity_resolutions FROM anon;
GRANT SELECT ON document_entity_resolutions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_entity_resolutions TO service_role;

COMMENT ON TABLE document_entity_resolutions IS 'Piece K — resolution layer linking document extractions to canonical core_entity rows. Supersedes the original 0213/0215 design that collided with legacy document_entities.';
