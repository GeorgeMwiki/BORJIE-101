-- =============================================================================
-- Migration 0322 — jurisdiction_proposals durable store (JC-7 four-eye).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The admin-only jurisdiction-override route
-- (services/api-gateway/src/routes/admin/tenant-jurisdiction.hono.ts,
-- createAdminTenantJurisdictionRouter) implements the JC-7 four-eye flow:
-- a tenant CANNOT self-change its jurisdiction (locked at signup,
-- migration 0149); only Borjie internal admin (SUPER_ADMIN / ADMIN /
-- SUPPORT) can re-assign, and the change must traverse a PROPOSE ->
-- APPROVE flow where the approver is a DIFFERENT admin (four-eye, per
-- CLAUDE.md inviolable). The router is a factory whose
-- `JurisdictionProposalStore` port had NO backing table — so the route
-- could not be mounted. This migration is the persistence half; the
-- composition-root Drizzle adapters + index.ts mount are the wiring half.
--
-- ONE TABLE
--   * jurisdiction_proposals — one row per proposed jurisdiction change.
--     `proposal_id` is the PK. `status` is the four-eye lifecycle
--     (pending -> approved | rejected). The proposer (`proposed_by_user_id`)
--     and the decider (`decided_by_user_id`) are captured so the route can
--     enforce four-eye (approver MUST differ from proposer) AND the audit
--     chain can record BOTH actors.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (tenant_id TEXT, no
-- FK — same shape as the blackboard_slots / cognitive_memory_* /
-- situational_model_entities families, migrations 0319 / 0309 / 0317).
-- FORCE-enables RLS with a tenant-isolation policy on the canonical
-- `app.current_tenant_id` GUC plus a service-role bypass mirroring 0319.
-- The admin override adapters run under SERVICE-ROLE context (admin
-- elevation per the router doc) so they can read + decide proposals
-- across tenants; the FORCE RLS + tenant policy isolates every ordinary
-- tenant-scoped caller. A TENANT can NEVER read ANOTHER tenant's
-- proposals.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around
-- the anon REVOKE. On a fully-migrated DB this is a pure no-op. Every
-- NOT NULL is on a freshly-created column WITH a DEFAULT (or supplied at
-- insert time) so the NOT-NULL backfill-hazard validator passes.
--
-- Companion files:
--   * packages/database/src/schemas/jurisdiction-proposals.schema.ts
--   * services/api-gateway/src/composition/jurisdiction-override-wiring.ts
--   * services/api-gateway/src/routes/admin/tenant-jurisdiction.hono.ts
--
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this
-- file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- jurisdiction_proposals — durable backing for the JC-7 four-eye flow.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS jurisdiction_proposals (
  proposal_id          text        NOT NULL,
  tenant_id            text        NOT NULL,
  from_country_code    text        NOT NULL,
  to_country_code      text        NOT NULL,
  reason               text        NOT NULL,
  -- Free-form out-of-band verification attestation (phone / ticket /
  -- in-person) captured verbatim into the audit chain on approval.
  verified_with        text        NOT NULL,
  proposed_by_user_id  text        NOT NULL,
  proposed_at          timestamptz NOT NULL DEFAULT now(),
  status               text        NOT NULL DEFAULT 'pending',
  decided_by_user_id   text,
  decided_at           timestamptz,
  decision_note        text,
  CONSTRAINT jurisdiction_proposals_pkey PRIMARY KEY (proposal_id),
  CONSTRAINT jurisdiction_proposals_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

-- List-by-tenant is the GET read (the admin lists pending + history for a
-- tenant).
CREATE INDEX IF NOT EXISTS idx_jurisdiction_proposals_tenant
  ON jurisdiction_proposals (tenant_id);
-- Pending-first lookup support (the LIST splits pending from history).
CREATE INDEX IF NOT EXISTS idx_jurisdiction_proposals_tenant_status
  ON jurisdiction_proposals (tenant_id, status);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass +
-- guarded anon REVOKE. Mirrors the 0319 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'jurisdiction_proposals'
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
