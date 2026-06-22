-- =============================================================================
-- Migration 0367 — document_uploads: add the missing `customer_id` column so the
-- live table matches the Drizzle schema (close a schema-ahead drift that 503'd
-- the documents list endpoint).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The Drizzle schema (packages/database/src/schemas/documents.schema.ts) defines
--
--     customerId: text('customer_id'),
--     customerIdx: index('document_uploads_customer_idx').on(table.customerId),
--
-- on `document_uploads`, and the documents BFF (services/api-gateway/.../mining/
-- documents.hono.ts) reads the table with Drizzle `.select()`, which expands to
-- the FULL schema column list — including `customer_id`.
--
-- But the LIVE table never received that column. The foundation migration 0185
-- creates the table with `CREATE TABLE IF NOT EXISTS document_uploads (...)`;
-- because the table already existed in the live DB (it predates 0185 — created
-- by the archived 0032_document_uploads.sql, which lacked customer_id), the
-- IF NOT EXISTS skipped the entire CREATE and the newer column was never added.
-- No later migration adds it, so live drifted one column behind the schema.
--
-- The symptom: `GET /api/v1/mining/documents` issued
--     SELECT ... customer_id ... FROM document_uploads
-- which threw 42703 (undefined_column), surfaced by the gateway's safe-error
-- layer as a 503 COLUMN_NOT_PROVISIONED honest degrade. An authenticated live
-- walk caught it.
--
-- FIX
-- ---
-- Add the column (nullable text — identical to the schema; no NOT NULL, so no
-- backfill hazard and no table rewrite) plus its index. Both statements are
-- idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS make
-- re-apply a no-op. No data is touched. RLS is unaffected (the table's existing
-- tenant-isolation + service-role policies cover all columns).
-- =============================================================================

ALTER TABLE document_uploads
  ADD COLUMN IF NOT EXISTS customer_id text;

CREATE INDEX IF NOT EXISTS document_uploads_customer_idx
  ON document_uploads (customer_id);
