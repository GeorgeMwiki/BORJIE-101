-- =============================================================================
-- Migration 0316 — workflow_registry + trigger_embedding
--                  (the modality arbiter's embeddable flow catalog).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- COG-07/AUT-14 — the modality arbiter (the single 7-way output head) must
-- nearest-neighbour DISCOVERED + AUTHORED + BUILT-IN flows the same way it does
-- learned skills (skill_registry.description_embedding). Until now flows lived
-- ONLY as a static in-code array (packages/ai-copilot/src/workflows/
-- workflow-registry.ts + workflow-engine BUILT_IN_WORKFLOW_DEFINITIONS),
-- selectable solely by explicit getWorkflow(id) — there was NO embeddable,
-- persisted catalog. So the arbiter's Tier-1 retrieval had nowhere to land the
-- "this turn IS the arrears-recovery workflow" decision.
--
-- This migration introduces `workflow_registry` with a `trigger_embedding
-- VECTOR(1536)` column + an ivfflat cosine index so the arbiter can cosine-match
-- a turn intent against a flow's trigger description. `loop_kind` distinguishes a
-- bounded multi-step workflow (routed to the workflow-engine) from a STANDING
-- loop (routed to @borjie/loop-runner: reactive | tab_tick | deep_research |
-- autonomous_24_7 | recipe_lifecycle). Until a flow is embedded it is selectable
-- only by explicit id (current behaviour preserved) — the column ships
-- DEFAULT NULL so there is NO backfill hazard.
--
-- SHAPE
-- -----
-- workflow_registry
--   id                   text  PK (stable row id).
--   tenant_id            text  FK→tenants, NULLABLE. NULL ⇒ GLOBAL flow
--                             (cross-tenant default, same pattern as global
--                             skills / corpus chunks). RLS key (canonical GUC).
--   flow_id              text  the workflow / loop identifier the engine /
--                             loop-runner dispatches.
--   name                 text  NL handle for audits + logs.
--   trigger_description  text  NL document the embedder vectorises.
--   trigger_embedding    vector(1536)  cosine retrieval vector. NULLABLE.
--   loop_kind            text  NULL ⇒ bounded workflow; else the standing loop
--                             kind. CHECK-constrained when present.
--   source               text  'built_in' | 'authored' | 'discovered'.
--   status               text  'active' | 'retired' | 'shadow'. Only 'active'
--                             is selectable by the arbiter.
--   definition           jsonb  opaque flow definition (steps/params). NULLABLE.
--   created_by           text  user id that authored the flow. NULLABLE.
--   created_at / updated_at  timestamptz, default now().
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors migration 0308):
--   tenant_id is TEXT and FK→tenants; the table FORCE-enables row-level
--   security. The tenant-isolation policy allows reads of GLOBAL rows
--   (tenant_id IS NULL) plus the caller's own tenant rows (matching the
--   global-skill read pattern the arbiter uses), and constrains writes to the
--   caller's own tenant via WITH CHECK on the canonical `app.current_tenant_id`
--   GUC (bare compare, no cast; NEVER the legacy `app.tenant_id`). A
--   service-role bypass policy mirrors the 0308 shape so the arbiter's
--   globally-unique reads run under withServiceRoleContext.
--
-- RAIL NOTE: this is a READ catalog for the arbiter. Selecting a flow does NOT
--   bypass any rail — the chosen modality still flows through the permission-mode
--   + 9-hook + composeWithRail gates; money/licence/deletion stay dual-control
--   HITL. Registering a NEW flow row routes through the body-change syscall
--   (EA-04), not a direct app write.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
--   CREATE TABLE / INDEX IF NOT EXISTS + guarded DO-blocks, plus a pg_roles
--   guard around the anon REVOKE and a guarded CREATE EXTENSION + guarded
--   vector-index build (the ivfflat index is skipped with a NOTICE when the
--   pgvector extension is absent, so a vanilla-Postgres CI apply never fails).
--   References only pre-existing infra (`tenants`). All NOT NULLs are on a
--   freshly-created table, so the NOT-NULL-backfill validator is satisfied.
--
-- Companion files:
--   * packages/database/src/schemas/workflow-registry.schema.ts
--   * down/0316_down_workflow_trigger_embedding.sql
-- =============================================================================

BEGIN;

-- pgvector — guarded; a no-op when already installed or unavailable.
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension unavailable (SQLSTATE=%); trigger_embedding falls back to text + seq-scan.', SQLSTATE;
  END;
END $$;

-- -----------------------------------------------------------------------------
-- workflow_registry — the persisted, embeddable flow catalog.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workflow_registry (
  id                  text        PRIMARY KEY,
  -- NULL => GLOBAL flow (shared across tenants).
  tenant_id           text        REFERENCES tenants(id) ON DELETE CASCADE,
  flow_id             text        NOT NULL,
  name                text        NOT NULL,
  trigger_description text        NOT NULL,
  -- NULLABLE — un-embedded flows are selectable only by explicit id.
  -- Added as a separate guarded ALTER below so the column degrades to TEXT
  -- when pgvector is unavailable.
  loop_kind           text,
  source              text        NOT NULL DEFAULT 'built_in',
  status              text        NOT NULL DEFAULT 'active',
  definition          jsonb,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_registry_status_chk
    CHECK (status IN ('active', 'retired', 'shadow')),
  CONSTRAINT workflow_registry_source_chk
    CHECK (source IN ('built_in', 'authored', 'discovered')),
  CONSTRAINT workflow_registry_loop_kind_chk
    CHECK (
      loop_kind IS NULL
      OR loop_kind IN (
        'reactive', 'tab_tick', 'deep_research',
        'autonomous_24_7', 'recipe_lifecycle'
      )
    )
);

-- trigger_embedding — VECTOR(1536) when pgvector is present, else text. The
-- column ships DEFAULT NULL (no backfill hazard) regardless of type.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'workflow_registry' AND column_name = 'trigger_embedding'
  ) THEN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
      EXECUTE 'ALTER TABLE workflow_registry ADD COLUMN trigger_embedding vector(1536)';
    ELSE
      EXECUTE 'ALTER TABLE workflow_registry ADD COLUMN trigger_embedding text';
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Access-path indexes.
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_workflow_registry_tenant_status
  ON workflow_registry (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_workflow_registry_tenant_flow
  ON workflow_registry (tenant_id, flow_id);

-- ivfflat (cosine) embedding index — only when trigger_embedding is a real
-- vector column. Skipped with a NOTICE (ANN falls back to seq-scan) when
-- pgvector is absent so a vanilla-Postgres CI apply never fails.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'workflow_registry'
       AND column_name = 'trigger_embedding'
       AND udt_name = 'vector'
  ) THEN
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_workflow_registry_trigger_embedding '
           || 'ON workflow_registry USING ivfflat (trigger_embedding vector_cosine_ops) '
           || 'WITH (lists = 100)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'workflow_registry ivfflat index creation skipped (SQLSTATE=%); ANN falls back to seq-scan.', SQLSTATE;
    END;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC (global-row reads allowed).
-- -----------------------------------------------------------------------------

ALTER TABLE workflow_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_registry FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workflow_registry'
       AND policyname = 'workflow_registry_tenant_isolation'
  ) THEN
    CREATE POLICY workflow_registry_tenant_isolation
      ON workflow_registry
      FOR ALL
      -- Read: global flows (tenant_id IS NULL) + the caller's own tenant rows.
      USING (
        tenant_id IS NULL
        OR tenant_id = current_setting('app.current_tenant_id', true)
      )
      -- Write: only into the caller's own tenant (never a foreign tenant; a
      -- global write requires the service-role bypass below).
      WITH CHECK (
        tenant_id = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Service-role bypass — mirror the 0308 shape so the arbiter's system reads
-- (run under withServiceRoleContext, which sets app.is_service_role='true')
-- and global-flow seeds are permitted without a tenant GUC hint.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'workflow_registry'
       AND policyname = 'workflow_registry_service_role_bypass'
  ) THEN
    CREATE POLICY workflow_registry_service_role_bypass
      ON workflow_registry
      FOR ALL
      USING (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.workflow_registry FROM anon;';
  END IF;
END $$;

COMMIT;
