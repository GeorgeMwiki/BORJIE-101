-- =============================================================================
-- DOWN Migration 0112 - Undo Journal (Wave SUPERPOWERS)
--
-- Reverses 0112_undo_journal.sql:
--   - DROP POLICY undo_journal_tenant_isolation
--   - DROP TABLE undo_journal CASCADE
--
-- Data loss: TRUE (every undo journal entry is destroyed). The
-- immutable AI audit chain in `ai_audit_chain` retains the underlying
-- write records; only the reversible-state snapshots are lost.
-- Envs:      dev | staging only (per registry policy).
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS undo_journal_tenant_isolation ON undo_journal;
DROP TABLE IF EXISTS undo_journal CASCADE;

COMMIT;
