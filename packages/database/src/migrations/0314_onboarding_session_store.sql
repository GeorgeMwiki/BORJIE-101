-- =============================================================================
-- Migration 0314 — onboarding_sessions durable store (RSS-09).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The move-in / tenant onboarding state machine
-- (`@borjie/domain-services/onboarding`, wired in
-- `services/api-gateway/src/routes/onboarding.ts`) was backed ONLY by a
-- process-level in-memory `Map` triple (byId / byCustomer / byLease). The
-- file's own header admits it: "Data is lost on gateway restart". At >1
-- replica each pod has its OWN map, so a multi-step onboarding that lands on a
-- different replica mid-flow finds NO session (MASTER_GAP_REGISTER RSS-09,
-- HIGH: "In-memory onboarding store fallback -> multi-step onboarding breaks
-- across replicas/rollout").
--
-- This migration creates the durable Postgres table backing the new Drizzle
-- repository counterpart, selected at request time when a DB handle is present
-- AND the `ONBOARDING_SESSION_STORE=drizzle` env flag is set. With the flag at
-- its default (`memory`) the in-memory repo is retained verbatim, so applying
-- this migration changes NOTHING about runtime behaviour until the flag flips.
--
-- One table:
--   * onboarding_sessions — one row per (tenant_id, onboarding_session_id).
--     The three queryable lookup keys (id, customer_id, lease_id) are columns;
--     the rest of the OnboardingSession aggregate (checklist, procedure log,
--     move-in report, utility records, language, channel, audit stamps) lives
--     in `payload` jsonb and is rehydrated verbatim by the repo.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (tenant_id TEXT, no FK —
-- same shape as the cognitive_memory_* / memory_v2_* families, migrations
-- 0309 / 0312). FORCE-enables RLS with a tenant-isolation policy on the
-- canonical `app.current_tenant_id` GUC (bare compare, no cast; NEVER the
-- legacy `app.tenant_id`) plus a service-role bypass mirroring 0309 so the
-- composition root's system reads (withServiceRoleContext) are permitted. The
-- composite PK (tenant_id, id) reproduces the old in-memory `${tenantId}::${id}`
-- isolation key.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is
-- on a freshly-created column (no backfill hazard) so the NOT-NULL safety
-- validator passes.
--
-- Companion files:
--   * packages/database/src/schemas/onboarding-sessions.schema.ts
--   * services/api-gateway/src/routes/onboarding-session-store.ts
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- onboarding_sessions — durable backing for the move-in OnboardingRepository.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  tenant_id   text        NOT NULL,
  id          text        NOT NULL,
  customer_id text        NOT NULL,
  lease_id    text        NOT NULL,
  state       text        NOT NULL,
  payload     jsonb       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_sessions_pkey PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_tenant_customer
  ON onboarding_sessions (tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_tenant_lease
  ON onboarding_sessions (tenant_id, lease_id);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass + guarded
-- anon REVOKE. Mirrors the 0309 / 0312 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'onboarding_sessions'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        tbl || '_tenant_isolation', tbl
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

COMMIT;
