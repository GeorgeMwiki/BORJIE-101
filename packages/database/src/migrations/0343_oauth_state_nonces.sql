-- =============================================================================
-- Migration 0343 — oauth_state_nonces: DURABLE single-use consumption of the
-- connector-OAuth `state` nonce (multi-replica replay protection).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The connector OAuth connect flow (services/api-gateway/src/routes/
-- integrations/connectors-oauth.hono.ts) authenticates its provider callback
-- with an HMAC-signed single-use `state` (nonce + expiry). v1 consumed the
-- nonce in a bounded IN-PROCESS map — documented as safe only for a
-- single-instance deployment. The Helm chart autoscales api-gateway to
-- minReplicas 2-3, so a captured `state` could be REPLAYED against a replica
-- that never saw the first consumption, re-running the authorization-code
-- exchange + credential upsert inside the 10-minute signature TTL window.
--
-- This table is the cluster-wide authority: the callback CONSUMES each nonce
-- with `INSERT ... ON CONFLICT (nonce) DO NOTHING RETURNING nonce` — exactly
-- one replica ever gets a row back; every replay (any replica) gets 0 rows
-- and is rejected with STATE_ALREADY_USED. The same consume statement purges
-- rows older than 15 minutes (the signature TTL is 10) so the table stays
-- tiny without a dedicated sweeper.
--
-- ONE TABLE
--   * oauth_state_nonces — one row per consumed state nonce. `nonce` is the
--     PRIMARY KEY (the ON CONFLICT arbiter). `tenant_id` is NULLABLE — the
--     table is platform-scoped infrastructure (the callback carries no JWT;
--     identity comes from the verified state, which today always carries a
--     tenant, but the schema does not force future platform-scoped flows to
--     fabricate one). `expires_at` mirrors the state signature expiry;
--     `created_at` drives the inline purge.
--
-- TENANT SCOPE (CLAUDE.md hard rule): FORCE ROW LEVEL SECURITY. Policies
-- mirror the 0341 shape: a tenant-isolation policy on the canonical
-- `app.current_tenant_id` GUC (the callback binds the GUC from the VERIFIED
-- state inside the consume transaction, exactly as the adjacent
-- connector_credentials write does) PLUS a service-role bypass so platform
-- ops / cleanup jobs can sweep expired rows across tenants. Guarded anon
-- REVOKE. Nonces are opaque random values — no PII, no token material.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is
-- on a freshly-created column (no backfill hazard).
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * services/api-gateway/src/composition/oauth-state-nonce-store.ts
--   * packages/database/src/migrations/down/0343_down_oauth_state_nonces.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS oauth_state_nonces (
  -- The single-use state nonce (16 random bytes, base64url — opaque). PRIMARY
  -- KEY is the ON CONFLICT arbiter that makes consumption exactly-once
  -- cluster-wide.
  nonce        text        PRIMARY KEY,
  -- NULLABLE: platform-scoped infrastructure table. Today's connector flow
  -- always writes the verified state's tenant; future platform-scoped OAuth
  -- flows may consume nonces with no tenant.
  tenant_id    text,
  -- Which connector's connect flow minted the state (observability only).
  connector_id text,
  -- The absolute expiry the state signature carries (signature TTL = 10 min).
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The inline purge predicate (`created_at < now() - interval '15 minutes'`)
-- scans by creation time; keep it an index scan as the table churns.
CREATE INDEX IF NOT EXISTS oauth_state_nonces_created_idx
  ON oauth_state_nonces (created_at);

-- -----------------------------------------------------------------------------
-- RLS — FORCE + tenant isolation on the canonical GUC + service-role bypass
-- (for platform ops / cross-tenant cleanup) + guarded anon REVOKE. Mirrors the
-- 0341 shape.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'oauth_state_nonces'
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

COMMENT ON TABLE oauth_state_nonces IS
  'Durable single-use consumption of connector-OAuth state nonces — the '
  'cluster-wide replay authority for the multi-replica api-gateway. The '
  'callback consumes via INSERT ... ON CONFLICT (nonce) DO NOTHING RETURNING; '
  '0 rows = replay = STATE_ALREADY_USED. Rows older than 15 minutes (the '
  'signature TTL is 10) are purged inline by the same consume statement. '
  'Platform-scoped (tenant_id nullable); FORCE RLS on app.current_tenant_id '
  '(the callback binds the GUC from the VERIFIED state) + service-role bypass.';

COMMIT;
