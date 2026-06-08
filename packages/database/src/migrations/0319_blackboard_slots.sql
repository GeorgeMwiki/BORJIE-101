-- =============================================================================
-- Migration 0319 — blackboard_slots durable store (EA-05 closure).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The cross-surface state bus — the blackboard CRDT slot spine in
-- `@borjie/blackboard-sota` (slots/slot-crdt.ts, slots/slot-store.ts,
-- handoff/handoff.ts) — is a fully-tested, completely DARK substrate: the slot
-- lattice exists only in process memory (createInMemorySlotsRepository), so a
-- decision/doc/task the MD posts in chat does NOT survive a process restart and
-- is NOT shared across replicas. MASTER_GAP_REGISTER files this as EA-05
-- (BLOCKER): "Cross-surface state bus (blackboard) reaches no surface — decision
-- can't project to 2nd screen". This migration is the persistence half of the
-- closure (the route + broadcaster + subscriber are the wiring half).
--
-- ONE TABLE
--   * blackboard_slots — one row per (tenant_id, slot_id). A CRDT
--     Last-Writer-Wins register over an arbitrary JSON `value` paired with a
--     `version` version-vector (per-actor Lamport counters) so the merge is a
--     lattice-join (commutative / associative / idempotent — out-of-order +
--     duplicate realtime deltas converge). The winning register fields
--     (writer_id, clock, wall_clock_ms, deleted) carry the LWW total-order key
--     (clock → wall_clock_ms → writer_id). `projections` is the handoff
--     provenance breadcrumb chain. The composite PK (tenant_id, slot_id) makes
--     the durable upsert idempotent and reproduces the in-memory
--     `${tenantId}::${slotId}` isolation key.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (tenant_id TEXT, no FK —
-- same shape as the cognitive_memory_* / memory_v2_* / onboarding_sessions /
-- situational_model_entities families, migrations 0309 / 0312 / 0314 / 0317).
-- FORCE-enables RLS with a tenant-isolation policy on the canonical
-- `app.current_tenant_id` GUC (bare compare, no cast; NEVER the legacy
-- `app.tenant_id`) plus a service-role bypass mirroring 0317 so the composition
-- root's out-of-band writes (withServiceRoleContext — the brain-teach board
-- persist path runs under the tenant GUC; the cross-replica broadcaster never
-- writes across tenants) are permitted while RLS FORCE isolates every other
-- caller. A TENANT can NEVER read ANOTHER tenant's slots.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is on
-- a freshly-created column WITH a DEFAULT (no backfill hazard) so the NOT-NULL
-- safety validator passes.
--
-- Companion files:
--   * packages/database/src/schemas/blackboard-slots.schema.ts
--   * packages/blackboard-sota/src/repositories/sql-slots-repository.ts
--   * services/api-gateway/src/composition/blackboard-slots-wiring.ts
--   * services/api-gateway/src/routes/blackboard.hono.ts
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- blackboard_slots — durable backing for the CRDT SlotsRepository.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blackboard_slots (
  tenant_id     text        NOT NULL,
  slot_id       text        NOT NULL,
  -- decision | document | task | draft | dataset | note (render hint).
  slot_kind     text        NOT NULL,
  -- Winning LWW register value; NULL == tombstoned (deleted slot).
  value         jsonb,
  -- The actor whose write currently holds the register.
  writer_id     text        NOT NULL,
  -- LWW total-order key: clock → wall_clock_ms → writer_id.
  clock         integer     NOT NULL DEFAULT 0,
  wall_clock_ms bigint      NOT NULL DEFAULT 0,
  deleted       boolean     NOT NULL DEFAULT false,
  -- CRDT version vector: per-actor Lamport counters (causal history).
  version       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Ordered handoff provenance chain (surfaces this slot reached).
  projections   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blackboard_slots_pkey PRIMARY KEY (tenant_id, slot_id),
  CONSTRAINT blackboard_slots_kind_chk
    CHECK (slot_kind IN (
      'decision', 'document', 'task', 'draft', 'dataset', 'note'
    ))
);

-- List-by-tenant is the hydrate read (a surface loads every slot on mount).
CREATE INDEX IF NOT EXISTS idx_blackboard_slots_tenant
  ON blackboard_slots (tenant_id);
-- Kind-filtered list support (a surface lens over one slot kind).
CREATE INDEX IF NOT EXISTS idx_blackboard_slots_tenant_kind
  ON blackboard_slots (tenant_id, slot_kind);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass + guarded
-- anon REVOKE. Mirrors the 0309 / 0312 / 0314 / 0317 shape exactly.
-- -----------------------------------------------------------------------------

-- NOTE on policy naming: the policy is named `tenant_isolation_<table>`
-- (prefix-form) rather than `<table>_tenant_isolation`. Both express the same
-- tenant-isolation policy on the canonical GUC; the prefix form is what the
-- repo's audit-rls-coverage scanner recognises for loop-installed RLS, so this
-- table is counted as covered without an allowlist entry. The `tenant_tables`
-- array variable name is likewise the scanner's recognised loop shape.
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'blackboard_slots'
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

COMMIT;
