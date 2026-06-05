-- =============================================================================
-- Migration 0158 — Mining document_type enum values
--
-- Adds three Tanzanian mining-domain values to the `document_type` pgEnum so
-- mining uploads can be classified on the canonical enum instead of being
-- routed solely via the loose classifier `kind` string / content sniff.
--
-- Companion to:
--   - packages/database/src/schemas/documents.schema.ts (documentTypeEnum list)
--   - services/api-gateway/src/routes/mining/document-extraction.ts
--       (selectSchemaForDocument — now switches on these enum values directly)
--   - packages/document-ai/src/form-extraction/schemas.ts
--       (miningLicenceSchema / royaltyReturnSchema / accountantExportSchema —
--        whose `id`s match these values 1:1)
--
-- Why dedicated enum values: the mining-schemas wave shipped the NamedSchemas
-- but mapped them onto the generic `notice` / `other` values via `kind` and a
-- content sniff (see the route header note). A first-class enum lets the upload
-- pipeline persist a precise type and lets `selectSchemaForDocument` key off the
-- most specific signal — `document_type` — the same way `lease_agreement` is.
--
-- TRANSACTION NOTE (read before touching): the migration runner
-- (packages/database/src/run-migrations.ts) wraps every migration body in
-- `sql.begin()`. PostgreSQL ≥ 12 permits `ALTER TYPE … ADD VALUE` inside a
-- transaction block PROVIDED the new label is not USED in the same transaction
-- (we only add labels here — no use), so this is safe under the runner. We
-- therefore add NO explicit `BEGIN;`/`COMMIT;` of our own (the runner supplies
-- the transaction, and `ADD VALUE` rejects nesting under some setups). Each
-- `ADD VALUE` is its own statement.
--
-- IDEMPOTENT: `ADD VALUE IF NOT EXISTS` (PostgreSQL ≥ 12) makes re-running a
-- no-op — replays and the CI dry-run never error on an already-present label.
--
-- BACKWARDS COMPATIBLE: enum labels are append-only and additive; no existing
-- row, column default, or check changes. Per CLAUDE.md no existing tenant
-- breaks.
--
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this file
-- after merge; append a new numbered file instead. Forward-only (enum labels
-- cannot be dropped without rebuilding the type, so there is no down file —
-- mirroring 0153 / 0157).
-- =============================================================================

-- Fresh-DB guard: on a fresh database the document_type enum does not exist
-- yet — it is created (with these three mining values already included) by
-- 0185_document_uploads_foundation.sql, which lands later in lex order. A
-- bare ALTER TYPE here aborts with "type document_type does not exist".
-- Guarding on type existence makes this a no-op on fresh (0185 supplies the
-- values) and a fully idempotent additive ALTER on production (where the enum
-- predates the mining values). EXECUTE keeps ADD VALUE deferred to runtime.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_type') THEN
    EXECUTE 'ALTER TYPE document_type ADD VALUE IF NOT EXISTS ''mining_licence''';
    EXECUTE 'ALTER TYPE document_type ADD VALUE IF NOT EXISTS ''royalty_return''';
    EXECUTE 'ALTER TYPE document_type ADD VALUE IF NOT EXISTS ''accountant_export''';
  END IF;
END $$;
