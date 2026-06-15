-- =============================================================================
-- Migration 0362 — driver_letter_acks: CREATE the durable acknowledgement table
-- for the offline-field-capture `/api/v1/mining/driver-letter-acks` sink.
--
-- WHY THIS MIGRATION EXISTS (closing the last degraded leg of the BLOCKER)
-- ----------------------------------------------------------------------
-- The five workforce-mobile offline-sync entity types flush to gateway sinks
-- in services/api-gateway/src/routes/mining/field-capture.hono.ts. Four of them
-- (ppe-receipts, excavator-counts, photo-uploads, fingerprint-signs) persist to
-- a real domain table. The fifth — `driver-letter-acks` — had NO target table,
-- so its router DEGRADED to an audit-only accept (it wrote only the hash-chained
-- ai_audit_chain row and returned meta.degraded=true). That meant the driver
-- letter acknowledgement itself was never queryable as a first-class row.
--
-- This migration creates `driver_letter_acks` so the sink can persist a REAL
-- row inside the SAME transaction as the audit append — exactly like the other
-- four sinks — and the degraded flag can be dropped.
--
-- COLUMN CONTRACT — the union of what the sink writes (id/tenant/user from auth,
-- the domain fields letter_id/driver_id/site_id/geo/attributes from the request
-- body). `id` is the deterministic rowId derived from (tenant, Idempotency-Key)
-- so an at-least-once re-flush collides on the PK and is no-op'd
-- (ON CONFLICT DO NOTHING).
--
-- TENANT SCOPE (CLAUDE.md hard rule): FORCE ROW LEVEL SECURITY + a tenant-
-- isolation policy on the canonical `app.current_tenant_id` GUC + a service-
-- role bypass (so an out-of-band reconciliation/export cron can read via
-- `withServiceRoleContext`, exactly like the other field-capture spine tables).
-- Guarded anon REVOKE for defence-in-depth.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): CREATE TABLE IF NOT
-- EXISTS + CREATE INDEX IF NOT EXISTS + pg_policies-guarded CREATE POLICY +
-- pg_roles-guarded anon REVOKE, wrapped in BEGIN/COMMIT. Re-apply on a
-- fully-migrated DB is a pure no-op. Every NOT NULL is on a freshly-created
-- column (no backfill hazard) so the NOT-NULL safety validator passes.
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/driver-letter-acks.schema.ts
--   * services/api-gateway/src/routes/mining/field-capture.hono.ts (the sink)
--   * packages/database/src/migrations/0348_notification_dispatch_log.sql (the pattern)
--   * packages/database/src/migrations/down/0362_down_driver_letter_acks.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS driver_letter_acks (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  letter_id       text,
  driver_id       text,
  site_id         text,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  geo             text,
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Tenant-scoped lookup index (the existsById replay check + tenant scans).
CREATE INDEX IF NOT EXISTS idx_driver_letter_acks_tenant
  ON driver_letter_acks (tenant_id);

-- Per-letter lookup within a tenant (which drivers acked a given letter).
CREATE INDEX IF NOT EXISTS idx_driver_letter_acks_tenant_letter
  ON driver_letter_acks (tenant_id, letter_id);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC + service-role bypass (for the
-- out-of-band reconciliation/export cron) + guarded anon REVOKE. Mirrors 0348.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text := 'driver_letter_acks';
BEGIN
  IF to_regclass('public.' || quote_ident(tbl)) IS NULL THEN
    RAISE NOTICE 'driver_letter_acks absent — skipping RLS (fresh-DB guard)';
    RETURN;
  END IF;

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
END $$;

COMMENT ON TABLE driver_letter_acks IS
  'Durable driver-letter acknowledgements captured via the offline-field '
  'capture /api/v1/mining/driver-letter-acks sink. id is the deterministic '
  'rowId derived from (tenant, Idempotency-Key) for at-least-once idempotency. '
  'FORCE RLS on app.current_tenant_id + service-role bypass for out-of-band '
  'reconciliation/export.';

COMMIT;
