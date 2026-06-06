-- =============================================================================
-- Migration 0285 — mining_sic_ping_replies (worker SIC-ping quick reply).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `mining_sic_pings` (migration 0082) is a one-shot supervisor status
-- emission and has NO columns for a worker's reply. The workforce-mobile
-- SIC screen (apps/workforce-mobile/app/worker/W-M-05.tsx) lets a worker
-- send a quick reply (loads done + blockers) which, until now, only
-- offline-queued because no reply endpoint / table existed (WF-6 gap).
-- This migration stands up the real backing table so the reply persists.
--
-- A reply is a distinct append-only fact, so it gets its own row rather
-- than mutating the ping (which would break the append-only spirit of the
-- SIC queue). The offline client generates a *client-side* ping ref
-- (`ping-<epoch>`) that is NOT a real mining_sic_pings.id, so the link is
-- stored as free-text `client_ping_ref`; the optional real `ping_id` FK
-- is set only when the route is called with a concrete ping id
-- (POST /sic-pings/:id/reply). Neither is required — nothing is fabricated.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0082/0284):
--   tenant_id is TEXT; FORCE ROW LEVEL SECURITY + a tenant policy on the
--   canonical `app.current_tenant_id` GUC (the GUC the api-gateway
--   databaseMiddleware binds). The compare is bare (no cast) because
--   tenant_id is already TEXT. NEVER the legacy app.tenant_id.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): nothing here is money.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule: migrations are
-- immutable + forward-only). Every object uses CREATE TABLE IF NOT EXISTS /
-- guarded DO-blocks (pg_policies checks) / CREATE INDEX IF NOT EXISTS, and a
-- pg_roles guard around the anon REVOKE. On a fully-migrated DB this is a
-- pure no-op. References only pre-existing infra (pgcrypto for
-- gen_random_uuid).
--
-- Companion files:
--   * packages/database/src/schemas/mining-sic-ping-replies.schema.ts
--   * services/api-gateway/src/routes/mining/cockpit.hono.ts (POST reply)
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- mining_sic_ping_replies
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mining_sic_ping_replies (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  ping_id             uuid,
  client_ping_ref     text,
  replied_by_user_id  text        NOT NULL,
  loads               integer,
  loads_raw           text,
  blockers            text,
  replied_at          timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mining_sic_ping_replies_tenant_replied_at
  ON mining_sic_ping_replies (tenant_id, replied_at);

CREATE INDEX IF NOT EXISTS idx_mining_sic_ping_replies_ping
  ON mining_sic_ping_replies (tenant_id, ping_id);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC.
-- -----------------------------------------------------------------------------

ALTER TABLE mining_sic_ping_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE mining_sic_ping_replies FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mining_sic_ping_replies'
       AND policyname = 'mining_sic_ping_replies_tenant_isolation'
  ) THEN
    CREATE POLICY mining_sic_ping_replies_tenant_isolation
      ON mining_sic_ping_replies
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
    EXECUTE 'REVOKE ALL ON public.mining_sic_ping_replies FROM anon;';
  END IF;
END $$;

COMMIT;
