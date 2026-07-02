-- =============================================================================
-- Migration 0372 — affective_profiles: durable theory-of-mind accumulator.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The affective accumulator (packages/central-intelligence/src/kernel/
-- theory-of-mind.ts) tracks five per-(tenant,user) [0,1] dimensions
-- (frustration / comprehension / anxiety / trust / urgency) that the kernel
-- mixes into the persona directive ("the last N turns showed escalating
-- frustration; soften tone"). Until now the store was a process-local in-memory
-- Map (24h TTL, 10k LRU) — every profile is LOST on api-gateway restart/deploy
-- and is NOT shared across replicas, so a user talking to replica B never sees
-- the affective history replica A accumulated. That is the "cross-turn memory
-- silently resets" false-continuity class.
--
-- This table gives the accumulator a durable, multi-replica-safe backing store.
-- The in-memory Map remains the hot cache + fail-safe fallback; a DB-backed
-- store (packages/central-intelligence + api-gateway wiring) write-throughs
-- observe() upserts here and hydrates read()s on a cache miss.
--
-- SHAPE
--   One row per (tenant_id, user_id, dimension) — a narrow long-format key so a
--   single upsert per dimension is a trivial ON CONFLICT and the whole profile
--   is five rows. `value` is the running [0,1] score; `expires_at` carries the
--   24h TTL so an expired profile reads as absent (matching the in-memory TTL);
--   `turns` mirrors the in-memory turn counter for the `turns < 2` render gate.
--
-- RLS
--   FORCE ROW LEVEL SECURITY + tenant-isolation on `app.current_tenant_id`
--   (the request-path GUC every tenant-scoped table uses) + a service-role
--   bypass so the shared service-role pool can hydrate/upsert cross-tenant
--   (the exact 0342/0354 dark-worker pattern). Policies are OR'd, so a
--   request-path read still scopes to its own tenant.
--
-- All base tables in this repo key `tenant_id` as TEXT; this matches so the GUC
-- comparison is a direct text equality with no cast hazard.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): CREATE ... IF NOT EXISTS
-- + pg_policies-guarded CREATE POLICY; re-run is a no-op. Pure DDL — no data
-- touched, no NOT-NULL backfill / lock hazard. Immutable + forward-only.
--
-- Companion files:
--   * packages/database/src/schemas/affective-profiles.schema.ts
--   * packages/central-intelligence/src/kernel/theory-of-mind.ts (pluggable store)
--   * packages/database/src/migrations/down/0372_down_affective_profiles.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS affective_profiles (
  tenant_id   text           NOT NULL,
  user_id     text           NOT NULL,
  dimension   text           NOT NULL,
  value       numeric(4, 3)  NOT NULL,
  turns       integer        NOT NULL DEFAULT 0,
  expires_at  timestamptz    NOT NULL,
  updated_at  timestamptz    NOT NULL DEFAULT now(),
  CONSTRAINT affective_profiles_pk
    PRIMARY KEY (tenant_id, user_id, dimension),
  CONSTRAINT affective_profiles_value_chk
    CHECK (value >= 0 AND value <= 1),
  CONSTRAINT affective_profiles_turns_chk
    CHECK (turns >= 0),
  CONSTRAINT affective_profiles_dimension_chk
    CHECK (dimension IN ('frustration','comprehension','anxiety','trust','urgency'))
);

-- Read path filters (tenant_id, user_id) and drops expired rows.
CREATE INDEX IF NOT EXISTS affective_profiles_tenant_user_idx
  ON affective_profiles (tenant_id, user_id, expires_at);

ALTER TABLE affective_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE affective_profiles FORCE  ROW LEVEL SECURITY;

-- Request-path tenant isolation.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'affective_profiles'
       AND policyname = 'affective_profiles_tenant_isolation'
  ) THEN
    CREATE POLICY affective_profiles_tenant_isolation ON affective_profiles
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- Service-role bypass so the shared service-role pool can hydrate/upsert
-- cross-tenant (multi-replica warmup + write-through). Same 0342/0354 pattern.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'affective_profiles'
       AND policyname = 'affective_profiles_service_role_bypass'
  ) THEN
    CREATE POLICY affective_profiles_service_role_bypass ON affective_profiles
      FOR ALL
      USING (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;
END $$;

COMMIT;
