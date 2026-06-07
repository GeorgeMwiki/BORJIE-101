-- =============================================================================
-- Migration 0302 — agent_memory (durable backend for the Anthropic memory tool).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The brain kernel's `/memories` primitive — the Anthropic `memory_20250818`
-- tool surface in `@borjie/central-intelligence`
-- (kernel/orchestrator/memory-tool.ts) — is the agent's OWN working notebook:
-- a per-scope set of files it reads + writes between turns to remember its
-- plan, partial computations, and intermediate tool outputs. The kernel's
-- main-loop ALREADY consumes it (`memoryTool.recall({ scope })` at the start
-- of each tick), but `compose.ts` only ever wires the in-memory adapter
-- (`createInMemoryMemoryTool()`), whose LRU map RESETS ON RESTART — so the
-- agent forgets everything it noted to itself on every deploy and shares
-- nothing across replicas. The port's own header calls for "an S3 /
-- local-disk / Postgres-jsonb adapter"; this migration stands up the
-- Postgres-jsonb one.
--
-- SHAPE / MAPPING ONTO THE PORT
-- -----------------------------
-- The canonical `MemoryTool` is path-scoped (threadId + path → content). This
-- table models that exactly while matching the prescribed agent-memory column
-- contract:
--   * agent_id  ← the port's scope key (threadId; a tenant's threads, or the
--                 reserved '_platform' bucket for platform-scope threads).
--   * mem_key   ← the safe, normalised memory path (e.g.
--                 '/memories/thread_<id>/plan.md'); path traversal is blocked
--                 in code by `safeMemoryPath` before it ever reaches here.
--   * mem_value ← jsonb `{ "content": <text>, "updatedAt": <iso> }` — the
--                 file body plus its last-write timestamp.
-- A UNIQUE(tenant_id, agent_id, mem_key) gives the writer last-write-wins
-- upsert semantics (ON CONFLICT) and the canonical `create` precondition
-- ('already-exists') a single source of truth.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors migrations 0289 / 0295):
--   tenant_id is TEXT and FK→tenants; the table FORCE-enables row-level
--   security with a tenant-isolation policy on the canonical
--   `app.current_tenant_id` GUC. Bare compare (no cast). NEVER the legacy
--   `app.tenant_id`. Platform-scope threads are stored under a dedicated
--   '_platform' SENTINEL tenant row so they remain RLS-scoped rather than
--   NULL-tenant (which would bypass the policy).
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
--   CREATE TABLE / INDEX IF NOT EXISTS + guarded DO-blocks, plus a pg_roles
--   guard around the anon REVOKE. On a fully-migrated DB this is a pure no-op.
--   References only pre-existing infra (`tenants`, pgcrypto). The '_platform'
--   sentinel tenant is upserted idempotently.
--
-- Companion files:
--   * packages/database/src/schemas/agent-memory.schema.ts
--   * services/api-gateway/src/composition/memory/drizzle-memory-tool.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Platform-scope sentinel tenant — so platform `/memories` rows stay
-- RLS-scoped (never NULL-tenant, which would escape the policy). Idempotent.
-- Guarded so it only runs when the `tenants` table exposes the columns we set.
-- -----------------------------------------------------------------------------

-- `tenants` requires (id, name, slug) — all NOT NULL with no default. We set
-- all three when present, and gate the whole insert on slug existing so the
-- migration stays correct against any historical tenants shape.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'tenants' AND column_name = 'name'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'tenants' AND column_name = 'slug'
  ) THEN
    -- `primary_email` is NOT NULL with no default on the production tenants
    -- table, so the sentinel row must supply a (non-routable) system address.
    INSERT INTO tenants (id, name, slug, primary_email)
    VALUES ('_platform', 'Platform (system scope)', '_platform', 'platform@borjie.internal')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- agent_memory
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_memory (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Memory scope key (threadId, or '_platform' for platform-scope threads).
  agent_id   text        NOT NULL,
  -- Normalised, traversal-safe memory path (see safeMemoryPath in code).
  mem_key    text        NOT NULL,
  -- { "content": <file body>, "updatedAt": <iso8601> }
  mem_value  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_memory_tenant_agent_key_uq'
  ) THEN
    ALTER TABLE agent_memory
      ADD CONSTRAINT agent_memory_tenant_agent_key_uq
      UNIQUE (tenant_id, agent_id, mem_key);
  END IF;
END $$;

-- Recall + directory listing both scan by (tenant, agent) then path prefix.
CREATE INDEX IF NOT EXISTS idx_agent_memory_tenant_agent
  ON agent_memory (tenant_id, agent_id);

-- Path-prefix listing (text_pattern_ops makes LIKE 'prefix%' index-usable).
CREATE INDEX IF NOT EXISTS idx_agent_memory_tenant_agent_key
  ON agent_memory (tenant_id, agent_id, mem_key text_pattern_ops);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC.
-- -----------------------------------------------------------------------------

ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'agent_memory'
       AND policyname = 'agent_memory_tenant_isolation'
  ) THEN
    CREATE POLICY agent_memory_tenant_isolation
      ON agent_memory
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.agent_memory FROM anon;';
  END IF;
END $$;

COMMIT;
