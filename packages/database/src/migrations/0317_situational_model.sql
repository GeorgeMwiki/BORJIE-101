-- =============================================================================
-- Migration 0317 — situational_model durable store (Wave 1, organ #2).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The resident `EstateMind` Slow Loop (packages/central-intelligence/src/kernel/
-- estate-mind) holds a STANDING, per-tenant, decaying Current Situational Model
-- over the estate entities the MD currently cares about (licences,
-- counterparties, pits/sites, arrears, equipment, cash). Each entity carries an
-- ACT-R activation/salience field so "what is salient now" is a computed
-- quantity (Docs/research/MD_COGNITIVE_KERNEL_ARCHITECTURE.md §2.3, organ #2).
--
-- The kernel ships two volatile adapters (in-memory + blackboard slot) and this
-- DURABLE Drizzle adapter so the situational model SURVIVES a process restart —
-- the resident mind resumes from its last persisted state rather than rebuilding
-- the recency×frequency series cold. The adapter is selected at the composition
-- root ONLY when a live DB handle is present; the in-memory fallback is the
-- default. Applying this migration changes NOTHING about runtime behaviour until
-- the resident loop is enabled (env BORJIE_ESTATE_MIND, default OFF).
--
-- ONE TABLE
--   * situational_model_entities — one row per (tenant_id, kind, entity_id).
--     Carries the ACT-R "optimized learning" base-level summary
--     (reference_count, first_referenced_at, last_referenced_at) so the row
--     stays bounded (we never store every reference timestamp), plus the
--     domain measurements the motivation drives read (`attributes` jsonb) and
--     the spreading-activation links (`associations` jsonb). Activation itself
--     is NEVER stored — it is a pure function of the row + read-instant.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (tenant_id TEXT, no FK —
-- same shape as the cognitive_memory_* / memory_v2_* / onboarding_sessions
-- families, migrations 0309 / 0312 / 0314). FORCE-enables RLS with a
-- tenant-isolation policy on the canonical `app.current_tenant_id` GUC (bare
-- compare, no cast; NEVER the legacy `app.tenant_id`) plus a service-role
-- bypass mirroring 0309/0312/0314 so the composition root's out-of-band worker
-- reads (withServiceRoleContext / the leader heartbeat) are permitted. The
-- composite PK (tenant_id, kind, entity_id) reproduces the kernel's
-- `${kind}:${entityId}` entity key within a tenant.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is
-- on a freshly-created column (no backfill hazard) so the NOT-NULL safety
-- validator passes.
--
-- Companion files:
--   * packages/database/src/schemas/situational-model.schema.ts
--   * services/api-gateway/src/composition/estate-mind-wiring.ts (Drizzle store)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- situational_model_entities — durable backing for the SituationalModelStore.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS situational_model_entities (
  tenant_id           text        NOT NULL,
  kind                text        NOT NULL,
  entity_id           text        NOT NULL,
  label               text        NOT NULL,
  -- Domain measurements the drives evaluate (opaque to the store).
  attributes          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Spreading-activation link strengths to other entity keys.
  associations        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- ACT-R "optimized learning" base-level summary (bounded; no per-ref series).
  reference_count     integer     NOT NULL DEFAULT 1,
  first_referenced_at timestamptz NOT NULL DEFAULT now(),
  last_referenced_at  timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT situational_model_entities_pkey
    PRIMARY KEY (tenant_id, kind, entity_id),
  CONSTRAINT situational_model_entities_kind_chk
    CHECK (kind IN (
      'licence', 'counterparty', 'site', 'arrears', 'equipment', 'cash'
    ))
);

-- List-by-tenant is the hot read (the loop snapshots every entity per tick).
CREATE INDEX IF NOT EXISTS idx_situational_model_tenant
  ON situational_model_entities (tenant_id);
-- Recency scan support for the opt-in prune path.
CREATE INDEX IF NOT EXISTS idx_situational_model_tenant_last_ref
  ON situational_model_entities (tenant_id, last_referenced_at);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass + guarded
-- anon REVOKE. Mirrors the 0309 / 0312 / 0314 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'situational_model_entities'
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
