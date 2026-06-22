-- =============================================================================
-- Migration 0368 — tenants: add the four scale-counter columns the Drizzle
-- schema + domain models + middleware already assume exist (close a
-- schema-ahead drift that 503'd every full-table read of `tenants`).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The Drizzle schema (packages/database/src/schemas/tenant.schema.ts) defines
--
--     maxProperties:     integer('max_properties').default(10),
--     maxUnits:          integer('max_units').default(100),
--     currentProperties: integer('current_properties').default(0),
--     currentUnits:      integer('current_units').default(0),
--
-- and these names are read across the codebase — packages/domain-models/src/
-- tenant/tenant.ts (the Tenant type + tier-limit derivation), services/
-- api-gateway/src/middleware/tenant-context.middleware.ts, and every tenant
-- seed (packages/database/src/seed.ts, seeds/*). They are scale-tier COUNTERS
-- (quota ceiling + current usage), not domain entities — the legacy property/
-- unit naming is pre-mining residue, but the residue-rename is a separate,
-- coordinated cleanup (tracked) and the entire code path expects these columns
-- to exist TODAY.
--
-- The LIVE table never received them: the table predates the migration that
-- introduced the columns, and that introduction used a CREATE-IF-NOT-EXISTS /
-- conditional path that skipped an already-present table. No later migration
-- adds them. So a Drizzle `.select().from(tenants)` — which expands to the FULL
-- schema column list — threw 42703 (undefined_column) on the four missing
-- columns, surfaced by the gateway safe-error layer as a 503
-- COLUMN_NOT_PROVISIONED. An authenticated live walk caught it on
-- GET /api/v1/mining/internal/tenants; it affected EVERY full-table tenants read.
--
-- FIX
-- ---
-- Add the four columns with the schema's exact integer defaults (nullable-safe:
-- a DEFAULT-backed ADD COLUMN on an existing row set is a metadata-only change
-- in PG 11+, no table rewrite, no backfill hazard). Idempotent: ADD COLUMN IF
-- NOT EXISTS makes re-apply a no-op. RLS is unaffected (existing tenants-table
-- policies cover all columns). No data is touched.
-- =============================================================================

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS max_properties integer DEFAULT 10;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS max_units integer DEFAULT 100;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS current_properties integer DEFAULT 0;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS current_units integer DEFAULT 0;
