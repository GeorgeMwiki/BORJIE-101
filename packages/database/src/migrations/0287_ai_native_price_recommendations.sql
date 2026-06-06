-- =============================================================================
-- Migration 0287 — price_recommendations (Agent PhL — dynamic-pricing durable
-- store).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The AI-native dynamic-pricing capability (`@borjie/ai-copilot/ai-native`
-- namespace `DynamicPricing`) computes a REAL per-pit mineral-price proposal
-- via an Anthropic LLM call clamped by the jurisdiction's price-control cap.
-- Every proposal is a `proposed`-status recommendation that the ApprovalService
-- (not this table) later turns into an actual price change — NOTHING here
-- mutates a live price.
--
-- Until now the proposal persisted ONLY to an in-process per-tenant map
-- (`services/api-gateway/src/composition/ai-native/in-memory-repos.ts`) because
-- the durable table lived only in the archived BossNyumba tree
-- (`packages/database/.archive/migrations/`) and was never carried into the
-- active Borjie migration tree. This migration stands up the real table so a
-- proposal survives a restart and is shared across replicas. The shape mirrors
-- the `PriceRecommendation` port row exactly (dynamic-pricing/types.ts).
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0285 / 0135):
--   tenant_id is TEXT; FORCE ROW LEVEL SECURITY + a tenant policy on the
--   canonical `app.current_tenant_id` GUC (the GUC the api-gateway
--   databaseMiddleware binds). The compare is bare (no cast) because tenant_id
--   is already TEXT. NEVER the legacy app.tenant_id.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): money is stored as integer
-- minor-units (`*_price_minor`) PLUS an explicit ISO-4217 `currency_code`
-- column. NO TZS / USD literal anywhere. `delta_pct` / `regulatory_cap_pct`
-- are percentages, not money.
--
-- ID DISCIPLINE: `id` is TEXT (the service generates a `pr_<epoch>_<rand>`
-- handle via the PhL `generateId` helper), matching `voice_turns` / the row
-- port's `id: string` — NOT a uuid default.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule: migrations are immutable
-- + forward-only). Every object uses CREATE TABLE IF NOT EXISTS / guarded
-- DO-blocks (pg_policies / pg_constraint checks) / CREATE INDEX IF NOT EXISTS,
-- and a pg_roles guard around the anon REVOKE. On a fully-migrated DB this is a
-- pure no-op. References only pre-existing infra (`tenants`, pgcrypto).
--
-- Companion files:
--   * packages/database/src/schemas/ai-native-pricing.schema.ts
--   * services/api-gateway/src/composition/ai-native/drizzle-repos.ts
--   * services/api-gateway/src/composition/ai-native-wiring.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- price_recommendations
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS price_recommendations (
  id                     text        PRIMARY KEY,
  tenant_id              text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pit_id                 text        NOT NULL,
  site_id                text,
  -- ISO-4217 currency for both price columns (never hardcoded in code).
  currency_code          text        NOT NULL,
  -- Money as integer minor-units (cents/sumuni) — never a float, never a literal.
  current_price_minor    bigint      NOT NULL,
  recommended_price_minor bigint     NOT NULL,
  -- Percentage delta of the proposal vs the current price (can be negative).
  delta_pct              double precision NOT NULL,
  confidence             double precision NOT NULL,
  -- YYYY-MM-DD review date the proposer suggests revisiting the pit.
  suggested_review_date  date        NOT NULL,
  -- Citations the proposer relied on (market signal, statute, ...).
  citations              jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Jurisdiction price-increase cap %, NULL when unrestricted.
  regulatory_cap_pct     double precision,
  cap_breached           boolean     NOT NULL DEFAULT false,
  explanation            text        NOT NULL DEFAULT '',
  model_version          text        NOT NULL,
  prompt_hash            text        NOT NULL,
  -- Always 'proposed' — the approval chain owns the lifecycle past this point.
  status                 text        NOT NULL DEFAULT 'proposed',
  created_at             timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_recommendations_status_chk'
  ) THEN
    ALTER TABLE price_recommendations
      ADD CONSTRAINT price_recommendations_status_chk
      CHECK (status IN ('proposed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'price_recommendations_confidence_chk'
  ) THEN
    ALTER TABLE price_recommendations
      ADD CONSTRAINT price_recommendations_confidence_chk
      CHECK (confidence BETWEEN 0 AND 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_price_recommendations_tenant_pit_created
  ON price_recommendations (tenant_id, pit_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_recommendations_tenant_created
  ON price_recommendations (tenant_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC.
-- -----------------------------------------------------------------------------

ALTER TABLE price_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_recommendations FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'price_recommendations'
       AND policyname = 'price_recommendations_tenant_isolation'
  ) THEN
    CREATE POLICY price_recommendations_tenant_isolation
      ON price_recommendations
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
    EXECUTE 'REVOKE ALL ON public.price_recommendations FROM anon;';
  END IF;
END $$;

COMMIT;
