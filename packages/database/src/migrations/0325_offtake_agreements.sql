-- =============================================================================
-- Migration 0325 — offtake_agreements (MARKETPLACE launch-blocker closure).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Accepting a marketplace bid (POST /api/v1/mining/bids/:id/accept) previously
-- only flipped the `marketplace_bids.status` to `accepted` — it crystallized NO
-- binding offtake agreement. There was no durable contract record at all: the
-- only reference to an "offtake agreement" lived in the excised estate
-- doc-routing action `estate.register_offtake_agreement`, which targeted a dead
-- surface. This migration creates the first-class binding-contract table so the
-- accept produces a real, queryable, tenant-isolated offtake agreement.
--
-- ONE TABLE
--   * offtake_agreements — one row per ACCEPTED bid. `UNIQUE(bid_id)` makes the
--     crystallization idempotent: re-accepting the same bid (at-least-once
--     retries, double-clicks) can never create a second contract. The money
--     columns (`agreed_price_tzs`, `quantity_kg`) are CONTRACT TERMS — the
--     negotiated price + volume — NOT ledger entries. Actual settlement still
--     routes through LedgerService.post() (immutable double-entry); this table
--     never posts accounting truth.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant-scoped (`tenant_id` TEXT = the
-- SELLER tenant, the listing owner; no FK — same shape as the
-- marketplace_bids / blackboard_slots / cognitive_memory_* families).
-- `buyer_tenant_id` is the buyer's own home tenant when known (nullable).
-- FORCE-enables RLS with a tenant-isolation policy on the canonical
-- `app.current_tenant_id` GUC (bare compare, no cast; NEVER the legacy
-- `app.tenant_id`) plus a service-role bypass mirroring 0319 so the composition
-- root's out-of-band writes are permitted while RLS FORCE isolates every other
-- caller. A TENANT can NEVER read ANOTHER tenant's offtake agreements.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is on
-- a freshly-created column WITH a DEFAULT (status, created_at, updated_at) or in
-- the same CREATE TABLE (no backfill hazard) so the NOT-NULL safety validator
-- passes.
--
-- Companion files:
--   * packages/database/src/schemas/offtake-agreements.schema.ts
--   * services/api-gateway/src/routes/mining/bids.hono.ts (accept crystallizes)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- offtake_agreements — binding contract crystallized on bid acceptance.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS offtake_agreements (
  id               text          NOT NULL,
  -- SELLER tenant (the listing owner). RLS isolation key.
  tenant_id        text          NOT NULL,
  listing_id       text          NOT NULL,
  -- The accepted marketplace_bids row. UNIQUE below → idempotent accept.
  bid_id           text          NOT NULL,
  -- The buyers row (in the seller tenant) that placed the bid.
  buyer_id         text          NOT NULL,
  -- The buyer's own home tenant, when known.
  buyer_tenant_id  text,
  -- CONTRACT TERM — negotiated price. NOT a ledger entry.
  agreed_price_tzs numeric(18,2) NOT NULL,
  -- CONTRACT TERM — agreed volume. NOT a ledger entry.
  quantity_kg      numeric(14,3) NOT NULL,
  payment_terms    text,
  status           text          NOT NULL DEFAULT 'pending_signature',
  signed_at        timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  -- Soft-delete tombstone (never hard-deleted).
  deleted_at       timestamptz,
  CONSTRAINT offtake_agreements_pkey PRIMARY KEY (id)
);

-- One offtake agreement per accepted bid → idempotent crystallization.
CREATE UNIQUE INDEX IF NOT EXISTS offtake_agreements_bid_id_key
  ON offtake_agreements (bid_id);
-- Seller-facing list-by-tenant read.
CREATE INDEX IF NOT EXISTS offtake_agreements_tenant_idx
  ON offtake_agreements (tenant_id);
-- Buyer-facing list-by-buyer read (tenant-scoped).
CREATE INDEX IF NOT EXISTS offtake_agreements_buyer_idx
  ON offtake_agreements (tenant_id, buyer_id);
-- Lookup by the originating listing.
CREATE INDEX IF NOT EXISTS offtake_agreements_listing_idx
  ON offtake_agreements (listing_id);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass + guarded
-- anon REVOKE. Mirrors the 0319 shape exactly.
-- -----------------------------------------------------------------------------

-- NOTE on policy naming: the policy is named `tenant_isolation_<table>`
-- (prefix-form) — the form the repo's audit-rls-coverage scanner recognises for
-- loop-installed RLS, so this table is counted as covered without an allowlist
-- entry. The `tenant_tables` array variable name is likewise the scanner's
-- recognised loop shape.
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'offtake_agreements'
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
