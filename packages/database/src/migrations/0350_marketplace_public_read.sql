-- =============================================================================
-- Migration 0350 — marketplace_listings cross-tenant PUBLIC READ.
--
-- A marketplace is cross-tenant by definition: a buyer in tenant A browses the
-- public listings sellers in tenants B/C/D have published. Today
-- `marketplace_listings` carries a single FOR ALL `tenant_isolation` policy
-- (migration 0297) under FORCE RLS, so the buyer-feed route
-- (services/api-gateway/src/routes/mining/marketplace.hono.ts) — which
-- INTENDS to surface `tanzania|regional|global` active listings across tenants
-- (its BUYER_VISIBLE filter) — silently returns ONLY the caller's own tenant's
-- rows. A fresh buyer in a brand-new tenant therefore sees an EMPTY marketplace
-- even when other tenants have public listings.
--
-- This migration ADDS a permissive `FOR SELECT` policy so a buyer can READ
-- ACTIVE, PUBLIC-TIER listings across tenants. It is purely ADDITIVE:
--   * Permissive policies of the same command are OR-ed, so SELECT now passes
--     when (own tenant — via tenant_isolation) OR (active + public-tier — via
--     this policy). PRIVATE listings from OTHER tenants stay hidden.
--   * Writes are UNCHANGED: INSERT/UPDATE/DELETE are still governed solely by
--     the FOR ALL `tenant_isolation` policy (own tenant only) — this policy is
--     SELECT-only and has no WITH CHECK, so it cannot widen any write path.
--   * status = 'active' is enforced at the DB (defense in depth) so a buyer
--     cannot read a cross-tenant paused/expired/sold/removed listing directly,
--     matching the route's own filter.
--
-- No data is seeded — listings appear only as REAL seller tenants publish them.
--
-- FRESH-DB SAFETY / IDEMPOTENCY: guarded on table existence; DROP-then-CREATE
-- the policy. Literal statements (not format/%I) so the rls-coverage static
-- analyzer recognises the policy. No new columns, no backfill.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/marketplace.schema.ts
--   * services/api-gateway/src/routes/mining/marketplace.hono.ts
--   * packages/database/src/migrations/down/0350_down_marketplace_public_read.sql
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'marketplace_listings'
  ) THEN
    DROP POLICY IF EXISTS marketplace_listings_public_read ON marketplace_listings;
    CREATE POLICY marketplace_listings_public_read
      ON marketplace_listings
      FOR SELECT
      USING (
        visibility IN ('tanzania', 'regional', 'global')
        AND status = 'active'
      );
  END IF;
END $$;

COMMENT ON POLICY marketplace_listings_public_read ON marketplace_listings IS
  'Cross-tenant buyer discovery: any caller may READ ACTIVE, public-tier '
  '(tanzania|regional|global) listings. Permissive — OR-ed with tenant_isolation '
  '(own-tenant + private). Writes stay tenant-locked (this policy is SELECT-only).';

COMMIT;
