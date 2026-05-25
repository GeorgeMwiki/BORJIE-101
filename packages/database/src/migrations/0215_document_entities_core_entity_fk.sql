-- Migration 0215 — Add the deferred FK from document_entities.resolved_entity_id → core_entity.id
--
-- Cross-piece integration: Piece K (document analysis) was developed in an
-- isolated worktree before Piece A (universal asset model) merged. Piece K
-- used a soft TEXT pointer for `resolved_entity_id` with a comment noting the
-- FK would be added after merge. This migration adds that FK.
--
-- Why it's safe: there are no rows in document_entities yet (Piece K is brand
-- new), so the FK is enforceable from inception. NOT VALID + VALIDATE
-- pattern is unnecessary.
--
-- See:
--   packages/database/src/migrations/0213_document_entities.sql
--   packages/database/src/migrations/0186_core_entity.sql

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'document_entities'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'core_entity'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'document_entities'
      AND constraint_name = 'document_entities_resolved_entity_id_fkey'
  )
  THEN
    ALTER TABLE document_entities
      ADD CONSTRAINT document_entities_resolved_entity_id_fkey
      FOREIGN KEY (resolved_entity_id)
      REFERENCES core_entity (id)
      ON DELETE SET NULL;

    COMMENT ON COLUMN document_entities.resolved_entity_id IS
      'FK to core_entity (Piece A). Set NULL when resolver cannot match the '
      'extracted entity to a canonical row; HITL path may patch later.';
  END IF;
END $$;
