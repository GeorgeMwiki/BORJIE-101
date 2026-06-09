-- =============================================================================
-- Migration 0323 — module-spawning control-plane registry (Piece B, Pass 2).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The module-orchestrator spawns MD-authored / template-instantiated modules
-- as first-class, durable control-plane rows. These are CORE PLATFORM tables —
-- NOT runtime-spawned tenant tables — so a DB CHECK constraint here is allowed
-- (the ddl-guard CHECK ban applies only to the runtime tenant_mod_ tables the
-- orchestrator compiles + applies at request time, never to this hand-authored
-- control plane). Pass 1 (the borjie-db-drift lane, 2026-06-08) removed the
-- earlier orphaned Drizzle defs as FALSE drift: their CREATE DDL lived only in
-- the archived migrations, never in the applied src/migrations chain, and
-- nothing carried runtime Drizzle I/O. Pass 2 re-instates them properly — this
-- forward migration is the applied CREATE the schema-migration-coverage gate
-- needs, and the wiring + orchestrator carry the real runtime I/O.
--
-- THREE TABLES
--   * modules         — tenant-scoped registry; one row per spawned module
--                       (slug + bilingual title, originating template/spec,
--                       isolated vector_namespace, scoped_tool_ids allowlist,
--                       coarse lifecycle_state, soft-delete tombstone).
--                       UNIQUE(tenant_id, slug) makes the spawn idempotent.
--   * module_specs    — tenant-scoped versioned compiled-spec + apply ledger.
--                       Carries the orchestrator's generated_migration_sql + the
--                       generated_zod_validators, then the executor stamps
--                       applied_migration_filename + applied_at + status. A
--                       CHECK enforces the honest apply-proof: status='applied'
--                       REQUIRES applied_migration_filename IS NOT NULL (mirrors
--                       0321's done-proof CHECK on confirmed_at).
--   * module_templates — GLOBAL built-in catalogue; NO tenant_id (every tenant
--                       reads the same built-ins). slug is globally UNIQUE.
--
-- TENANT SCOPE (CLAUDE.md hard rule):
--   modules + module_specs are tenant-scoped (tenant_id TEXT, no FK — same
--   shape as the md_commitments / situational_model / jurisdiction_proposals
--   families, migrations 0321 / 0317 / 0322). FORCE-enables RLS with a
--   tenant-isolation policy on the canonical `app.current_tenant_id` GUC (bare
--   compare, no cast; NEVER the legacy `app.tenant_id`) PLUS a service-role
--   bypass mirroring 0319/0321/0322 so the out-of-band module executor
--   (withServiceRoleContext) can persist the apply result while RLS FORCE still
--   isolates every request path. A TENANT can NEVER read ANOTHER tenant's
--   modules or specs.
--
--   module_templates has NO tenant boundary (global catalogue). It still
--   FORCE-enables RLS, but with a READ-ALL SELECT policy (USING true — any
--   authenticated caller may read the catalogue) plus a SERVICE-ROLE-ONLY write
--   policy (INSERT/UPDATE/DELETE gated on
--   `current_setting('app.is_service_role', true) = 'true'`). A tenant can READ
--   templates but NEVER write them.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is
-- on a freshly-created column WITH a DEFAULT (or supplied at insert time) so the
-- NOT-NULL backfill-hazard validator passes. UNIQUE(tenant_id, slug) /
-- UNIQUE(slug) make the spawn + catalogue upserts idempotent.
--
-- Companion files:
--   * packages/database/src/schemas/modules/modules.schema.ts
--   * packages/database/src/schemas/modules/module-specs.schema.ts
--   * packages/database/src/schemas/modules/module-templates.schema.ts
--   * services/api-gateway/src/composition/module-spawning-wiring.ts
--   * packages/module-orchestrator
--
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this file
-- after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- modules — per-tenant module-spawning registry.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS modules (
  id                  text        NOT NULL,
  tenant_id           text        NOT NULL,
  -- Human-stable slug, unique within a tenant.
  slug                text        NOT NULL,
  title               text        NOT NULL,
  -- Bilingual title (SW nullable until translated).
  title_sw            text,
  -- Originating module_templates.id when instantiated from a built-in.
  template_id         text,
  -- Latest applied module_specs.id (the spec that shaped this module).
  spec_id             text,
  -- Isolated pgvector namespace for this module's corpus.
  vector_namespace    text        NOT NULL,
  -- JSONB array of tool ids this module's juniors may reach.
  scoped_tool_ids     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Coarse lifecycle: DRAFT | ACTIVE | ARCHIVED.
  lifecycle_state     text        NOT NULL DEFAULT 'DRAFT',
  -- The user who authored / spawned this module (forensic replay).
  created_by_user_id  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Soft-delete tombstone; NULL == live.
  deleted_at          timestamptz,
  CONSTRAINT modules_pkey PRIMARY KEY (id)
);

-- Spawn idempotency — the same slug is never double-created per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS modules_tenant_slug_uniq
  ON modules (tenant_id, slug);
-- List-by-tenant is the registry read (a surface lists every module).
CREATE INDEX IF NOT EXISTS idx_modules_tenant
  ON modules (tenant_id);

-- -----------------------------------------------------------------------------
-- module_specs — per-module versioned compiled spec + apply result.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS module_specs (
  id                          text        NOT NULL,
  -- Parent modules.id this spec version belongs to.
  module_id                   text        NOT NULL,
  tenant_id                   text        NOT NULL,
  -- Monotonic spec version within a module.
  version                     integer     NOT NULL DEFAULT 1,
  -- The compiled module spec document.
  spec_jsonb                  jsonb       NOT NULL,
  -- The compiled runtime tenant-table DDL the executor applies.
  generated_migration_sql     text        NOT NULL,
  -- The compiled runtime input validators (JSONB-encoded zod shapes).
  generated_zod_validators    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Lifecycle: draft | applied | failed (see apply-proof CHECK).
  status                      text        NOT NULL DEFAULT 'draft',
  -- The migration filename the executor stamped on apply (NULL until applied).
  applied_migration_filename  text,
  -- Non-leaking failure reason when status = 'failed'.
  error                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  -- Set only on a successful apply.
  applied_at                  timestamptz,
  CONSTRAINT module_specs_pkey PRIMARY KEY (id),
  -- Honest apply-proof: an 'applied' spec MUST carry the filename it landed as.
  -- Mirrors 0321's done-proof CHECK on confirmed_at.
  CONSTRAINT module_specs_applied_proof_chk CHECK (
    status <> 'applied' OR applied_migration_filename IS NOT NULL
  )
);

-- Reconcile read: every spec version for a tenant's module.
CREATE INDEX IF NOT EXISTS idx_module_specs_tenant_module
  ON module_specs (tenant_id, module_id);

-- -----------------------------------------------------------------------------
-- module_templates — GLOBAL built-in catalogue (no tenant boundary).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS module_templates (
  id            text        NOT NULL,
  -- Globally-unique stable slug.
  slug          text        NOT NULL,
  -- English display title (required — EN is the default locale).
  title_en      text        NOT NULL,
  -- Swahili display title (bilingual; nullable until translated).
  title_sw      text,
  -- The seed spec the orchestrator instantiates into a tenant's module.
  default_spec  jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT module_templates_pkey PRIMARY KEY (id)
);

-- Globally-unique slug — the catalogue lookup + dedup key.
CREATE UNIQUE INDEX IF NOT EXISTS module_templates_slug_uniq
  ON module_templates (slug);

-- -----------------------------------------------------------------------------
-- RLS — modules + module_specs: tenant isolation on the canonical GUC +
-- service-role bypass (for the out-of-band module executor) + guarded anon
-- REVOKE. Mirrors the 0319 / 0321 / 0322 shape exactly. The `tenant_tables`
-- array variable name + the `tenant_isolation_<tbl>` policy prefix-form are the
-- loop shape the audit-rls-coverage scanner recognises, so both tables count as
-- covered without an allowlist entry.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'modules',
    'module_specs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = 'tenant_isolation_' || tbl
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        'tenant_isolation_' || tbl, tbl
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

-- -----------------------------------------------------------------------------
-- RLS — module_templates: GLOBAL catalogue (no tenant_id). FORCE RLS with a
-- READ-ALL SELECT policy (any caller may read the built-ins) + a
-- SERVICE-ROLE-ONLY write policy (INSERT/UPDATE/DELETE gated on the service-role
-- GUC) + guarded anon REVOKE. A tenant can READ templates but NEVER write them.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  EXECUTE 'ALTER TABLE module_templates ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'ALTER TABLE module_templates FORCE  ROW LEVEL SECURITY;';

  -- Read-all: any caller may read the global catalogue.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'module_templates'
       AND policyname = 'module_templates_read_all'
  ) THEN
    EXECUTE
      'CREATE POLICY module_templates_read_all ON module_templates '
      || 'FOR SELECT USING (true);';
  END IF;

  -- Service-role-only writes (INSERT/UPDATE/DELETE) — a tenant never writes.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'module_templates'
       AND policyname = 'module_templates_service_write'
  ) THEN
    EXECUTE
      'CREATE POLICY module_templates_service_write ON module_templates '
      || 'FOR ALL '
      || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
      || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.module_templates FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE modules IS
  'Piece B module-spawning registry: one tenant-scoped row per spawned module '
  '(slug + bilingual title, originating template/spec, isolated vector '
  'namespace, scoped tool allowlist, coarse lifecycle, soft-delete tombstone). '
  'UNIQUE(tenant_id, slug) makes the spawn idempotent. RLS FORCE-isolated on '
  'app.current_tenant_id.';

COMMENT ON TABLE module_specs IS
  'Piece B per-module versioned compiled-spec + apply ledger: generated runtime '
  'DDL + zod validators, then the executor stamps applied_migration_filename + '
  'applied_at + status. CHECK enforces status=applied REQUIRES a filename. RLS '
  'FORCE-isolated on app.current_tenant_id + service-role bypass for the '
  'out-of-band executor.';

COMMENT ON TABLE module_templates IS
  'Piece B GLOBAL built-in module catalogue (no tenant boundary): every tenant '
  'reads the same built-ins. slug is globally UNIQUE. RLS FORCE with read-all '
  'SELECT + service-role-only writes — a tenant can READ but never WRITE.';

COMMIT;
