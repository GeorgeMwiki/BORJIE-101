-- =============================================================================
-- Migration 0365 — RLS-enforcement closure: the additive policies that keep
-- the INTENTIONAL cross-tenant marketplace + buyer-projection + worker feeds
-- alive once FORCE ROW LEVEL SECURITY is actually enforced.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The prod gateway connects as a `rolbypassrls=t` role today, so FORCE RLS is
-- INERT — every policy below is a NO-OP right now (it can only ever ADMIT rows,
-- never deny, and the bypass role admits everything regardless). A cover-all
-- audit traced the cross-tenant READ/WRITE features that WOULD silently dark
-- the instant enforcement is turned on (the reminders-class signature: FORCE
-- RLS filters rather than errors, so the break is silent). Each carries only an
-- own-tenant `tenant_isolation` policy and no additive admit, so under enforced
-- RLS the caller's own GUC filters the cross-tenant feed to ZERO rows.
--
-- This migration adds the missing ADDITIVE policies. Permissive policies of the
-- same command OR together, so each one only ever WIDENS SELECT/INSERT for the
-- exact cross-tenant shape its route already intends; request-path tenant
-- isolation (own-tenant reads/writes) is left completely untouched.
--
--   1. request_for_bids — `rfb_open_public_read` (FOR SELECT): the RFB /nearby
--      seller-discovery feed (rfb.hono.ts:425-474) lets a seller in tenant B
--      see OPEN, unexpired RFBs buyers posted across ALL tenants. Mirrors the
--      0350 marketplace_listings_public_read shape: USING (status='open' AND
--      expires_at > now()). Cancelled/expired/filled/own-private RFB lifecycle
--      stays tenant-scoped; writes are untouched (SELECT-only, no WITH CHECK).
--
--   2. request_for_bid_responses — `rfb_responses_seller_insert` (FOR INSERT)
--      + `rfb_responses_seller_read` (FOR SELECT): the seller write-back POST
--      /:id/respond (rfb.hono.ts:570-586) INSERTs a response stamped with
--      tenant_id = the BUYER's tenant while running under the SELLER's GUC, so
--      the own-tenant WITH CHECK fails under enforcement. The insert already
--      stamps provenance.sellerTenantId = the seller's tenant (rfb.hono.ts:581),
--      so admit the write (and the seller's read-back) when
--      provenance->>'sellerTenantId' = the bound app.current_tenant_id.
--      (The route comment that previously cited "migration 0132" was wrong —
--      0132 is buyer_notifications; this policy is the real admit.)
--
--   3. owner_tabs_structural — `owner_tabs_structural_service_role_bypass`
--      (FOR ALL, the 0342/0357 shape): the buyer cross-tenant tab projection
--      (tab-projection.hono.ts:249-260) scans owner opt-in custom tabs across
--      the connected-membership graph UNDER withServiceRoleContext, but the
--      table has FORCE RLS with only an own-tenant policy and no bypass, so the
--      bound app.is_service_role='true' matches nothing → the projection darks
--      silently (catch → data:[]). Add the bypass so the bound context admits.
--
--   4. saved_searches — `saved_searches_service_role_bypass` (FOR ALL, the
--      0354 shape): the saved-search alert worker drains saved_searches
--      CROSS-TENANT every 60s (saved-search-worker-wiring.ts select_due op).
--      The companion code-fix wraps that drain in withServiceRoleContext; this
--      policy lets the bound app.is_service_role='true' open the rows. The
--      per-tenant ops (update-after-run, the source-corpus counts) stay scoped
--      by their own tenant_id predicate and are unaffected.
--
--   5. marketplace_listings — `marketplace_listings_service_role_bypass`
--      (FOR ALL, the 0342/0357 shape): the HQ moderation queue
--      (mining/internal/marketplace.hono.ts) is SUPER_ADMIN/ADMIN-only and must
--      see + hide/restore EVERY listing across every tenant regardless of
--      status/visibility — exactly the private/paused/removed rows that 0350's
--      active+public-tier read does NOT expose. The companion code-fix routes
--      the moderation reads + hide/restore writes through withServiceRoleContext
--      so the bound is_service_role='true' admits them. The request-path buyer
--      feed (own-tenant + 0350 active/public) is unchanged — this bypass only
--      fires under the service-role GUC, which ordinary requests never bind.
--
-- TENANT SCOPE (CLAUDE.md hard rule): RLS FORCE stays ON everywhere; no policy
-- is dropped or weakened; the canonical app.current_tenant_id tenant-isolation
-- path is untouched. Every policy here is purely ADDITIVE / permissive.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every table guarded by
-- to_regclass; every policy is a pg_policies-guarded CREATE (DROP-then-CREATE
-- for the literal SELECT policies so the rls-coverage static analyzer
-- recognises them); FORCE ROW LEVEL SECURITY is RE-ASSERTED, never dropped;
-- guarded anon REVOKE. Pure RLS metadata — no data touched, no NOT-NULL /
-- backfill / lock hazard. On a fully-migrated DB a re-run is a pure no-op.
--
-- SAFE-TO-LAND-NOW: under the inert (rolbypassrls=t) prod role NONE of these
-- policies change a single row of current behaviour — they can only admit, and
-- the bypass role already admits everything. They become load-bearing ONLY when
-- enforcement (SET LOCAL ROLE authenticated) is later flipped behind the
-- default-off BORJIE_ENFORCE_RLS flag.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * services/api-gateway/src/routes/marketplace/rfb.hono.ts (/nearby + /respond)
--   * services/api-gateway/src/routes/buyer/tab-projection.hono.ts (structural read)
--   * services/api-gateway/src/composition/saved-search-worker-wiring.ts (drain wrap)
--   * services/api-gateway/src/routes/mining/internal/marketplace.hono.ts (moderation)
--   * packages/database/src/migrations/0350_marketplace_public_read.sql (the SELECT pattern)
--   * packages/database/src/migrations/0354_reminders_service_role_bypass.sql (the bypass pattern)
--   * packages/database/src/migrations/down/0365_down_rls_enforcement_cross_tenant_closure.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. request_for_bids — cross-tenant OPEN-RFB seller-discovery read.
--    Literal DROP-then-CREATE (0350 shape) so the static analyzer sees it.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.request_for_bids') IS NOT NULL THEN
    ALTER TABLE request_for_bids ENABLE ROW LEVEL SECURITY;
    ALTER TABLE request_for_bids FORCE  ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS rfb_open_public_read ON request_for_bids;
    CREATE POLICY rfb_open_public_read
      ON request_for_bids
      FOR SELECT
      USING (
        status = 'open'
        AND expires_at > now()
      );

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON public.request_for_bids FROM anon;
    END IF;
  END IF;
END $$;

COMMENT ON POLICY rfb_open_public_read ON request_for_bids IS
  'Cross-tenant seller discovery: any caller may READ OPEN, unexpired RFBs '
  '(matches the /nearby route filter). Permissive — OR-ed with '
  'rfb_tenant_isolation (own-tenant + cancelled/expired/filled). Writes stay '
  'tenant-locked (SELECT-only, no WITH CHECK).';

-- -----------------------------------------------------------------------------
-- 2. request_for_bid_responses — seller cross-tenant write-back + read-back.
--    The response carries tenant_id = the BUYER's tenant; admit when the
--    provenance-stamped sellerTenantId equals the bound seller GUC.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.request_for_bid_responses') IS NOT NULL THEN
    ALTER TABLE request_for_bid_responses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE request_for_bid_responses FORCE  ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS rfb_responses_seller_insert ON request_for_bid_responses;
    CREATE POLICY rfb_responses_seller_insert
      ON request_for_bid_responses
      FOR INSERT
      WITH CHECK (
        provenance->>'sellerTenantId' = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS rfb_responses_seller_read ON request_for_bid_responses;
    CREATE POLICY rfb_responses_seller_read
      ON request_for_bid_responses
      FOR SELECT
      USING (
        provenance->>'sellerTenantId' = current_setting('app.current_tenant_id', true)
      );

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      REVOKE ALL ON public.request_for_bid_responses FROM anon;
    END IF;
  END IF;
END $$;

COMMENT ON POLICY rfb_responses_seller_insert ON request_for_bid_responses IS
  'Cross-tenant seller write-back: the seller responds to a buyer-tenant RFB; '
  'the response stamps tenant_id = buyer tenant + provenance.sellerTenantId = '
  'seller tenant. Admit the INSERT when provenance.sellerTenantId equals the '
  'bound app.current_tenant_id. Permissive — OR-ed with rfb_responses_tenant_'
  'isolation (own-tenant). The buyer-tenant owner still reads via tenant_isolation.';

COMMENT ON POLICY rfb_responses_seller_read ON request_for_bid_responses IS
  'Seller read-back of its own cross-tenant responses (provenance.sellerTenantId '
  '= bound app.current_tenant_id). Permissive — OR-ed with tenant_isolation.';

-- -----------------------------------------------------------------------------
-- 3-5. service_role_bypass on the three cross-tenant-system tables —
--      the EXACT 0342/0354/0357 policy shape, existence-guarded per table.
--      FORCE re-asserted; existing tenant policies untouched; guarded anon
--      REVOKE. The bound app.is_service_role='true' (withServiceRoleContext)
--      is what opens the rows; ordinary requests never set it, so the
--      tenant-isolation path is unchanged.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'owner_tabs_structural',
    'saved_searches',
    'marketplace_listings'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF to_regclass('public.' || quote_ident(tbl)) IS NULL THEN
      RAISE NOTICE '% absent — skipping service-role bypass (fresh-DB guard)', tbl;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

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
