-- =============================================================================
-- Migration 0320 — platform_llm_routing_config (LLM control-plane store).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The Borjie internal admin console (apps/admin-web, port 3020 — the Borjie
-- TEAM console, platform config NOT tenant business data) gains a CONTROL
-- PLANE over the brain's model selection. Three of the four control-plane
-- knobs persist here; the POWERS / kill-switch grid reuses the existing
-- `platform_feature_flags` table (migration 0137) — this migration does NOT
-- duplicate it.
--
-- This table backs:
--   * CORE LLM + ORDERED FALLBACK CHAIN — the primary model and an ordered
--     failover chain (try core; on error/timeout cascade the chain).
--   * ENSEMBLE / all-at-once orchestration — a set of member models run in
--     parallel with a combine strategy (first-wins | majority-vote |
--     judge-synthesis | debate) + an optional judge model.
--   * PER-USE-CASE routing — a use-case -> model id map (e.g.
--     cheap-classification -> Haiku, deep-reasoning -> Opus).
--
-- The AI-SUGGEST recommender is suggest-only (it reads cost/capability/latency
-- metadata and proposes routing); the admin APPLIES a suggestion via a write
-- to THIS table (HITL). The recommender never writes.
--
-- SCOPE MODEL (mirrors platform_feature_flags exactly so the two stores read
-- the same way): one row per `scope`, where scope is either the literal
-- `global` (platform-wide default) or `tenant:<tenantId>` (per-tenant
-- override that supersedes global for that tenant). The whole routing config
-- for a scope lives in a single JSONB `config` document so a read is one row.
--
-- HARD INVARIANT: this config changes WHICH model answers, never WHETHER a
-- sovereign action (money / licence / deletion) executes. There is no column
-- here that can disable an HITL rail — those rails live in the policy-gate.
-- The router consumption layer is FAIL-SAFE: a bad/empty/absent config row
-- falls back to the static TASK_LADDER, so a malformed row can never break a
-- turn.
--
-- PLATFORM-METADATA (NOT tenant business data): this is internal Borjie team
-- configuration. It is NOT tenant-scoped via RLS on `app.current_tenant_id`
-- the way business tables are — it follows the platform_feature_flags model
-- (admin-only access enforced at the api-gateway route layer via
-- requireRole(SUPER_ADMIN); the `tenant:<id>` scope is a STRING key naming
-- which tenant a routing override applies to, NOT a row a tenant can read).
-- RLS is enabled + FORCE'd with a service-role-only policy so only the
-- composition root's service-role context (admin route handlers) can touch it;
-- `anon` is REVOKE'd. A tenant JWT path never reaches this table.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is
-- on a freshly-created column WITH a DEFAULT (no backfill hazard) so the
-- NOT-NULL safety validator passes. Re-running is harmless.
--
-- Companion files:
--   * packages/database/src/schemas/platform-llm-routing-config.schema.ts
--   * packages/database/src/services/platform/llm-routing-config.service.ts
--   * packages/brain-llm-router/src/routing-config/* (the consumer)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- platform_llm_routing_config — one row per scope; the full routing config for
-- that scope as a single JSONB document.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_llm_routing_config (
  id          text        PRIMARY KEY,
  -- Either the literal `global` or `tenant:<tenantId>`. The route layer
  -- validates the shape; the DB stores it verbatim so a read is one keyed row.
  scope       text        NOT NULL,
  -- The full LlmRoutingConfig document:
  --   { coreModel, orderedFallbacks[], ensemble?{enabled,members[],
  --     combineStrategy,judgeModel?}, perUseCase?{useCase->modelId} }
  -- Duck-typed + validated by the router's validateRoutingConfig before it
  -- ever reaches the hot path; a malformed row is treated as absent (fail-safe).
  config      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text        NOT NULL DEFAULT 'system',
  last_set_at timestamptz NOT NULL DEFAULT now(),
  last_set_by text        NOT NULL DEFAULT 'system',
  CONSTRAINT uq_platform_llm_routing_config_scope UNIQUE (scope)
);

-- Scope is the only lookup key (read-by-scope on the warm path).
CREATE INDEX IF NOT EXISTS idx_platform_llm_routing_config_scope
  ON platform_llm_routing_config (scope);

-- -----------------------------------------------------------------------------
-- RLS — service-role-only (platform-metadata, NOT tenant-scoped business data).
-- Enable + FORCE so even the table owner is subject to policy; the only policy
-- is the service-role bypass (admin route handlers run under service-role).
-- A tenant JWT context (no app.is_service_role) sees zero rows. Guarded anon
-- REVOKE. Mirrors the platform-config posture, not the per-tenant RLS loop.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  EXECUTE 'ALTER TABLE platform_llm_routing_config ENABLE ROW LEVEL SECURITY;';
  EXECUTE 'ALTER TABLE platform_llm_routing_config FORCE  ROW LEVEL SECURITY;';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'platform_llm_routing_config'
       AND policyname = 'platform_llm_routing_config_service_role_only'
  ) THEN
    EXECUTE
      'CREATE POLICY platform_llm_routing_config_service_role_only '
      || 'ON platform_llm_routing_config FOR ALL '
      || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
      || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.platform_llm_routing_config FROM anon;';
  END IF;
END $$;

COMMIT;
