-- =============================================================================
-- Migration 0375 — oauth_action_approvals.initiated_by (four-eye SoD)
--
-- Wave AGENTIC-PLATFORM. The four-eye approval gate on the public MCP
-- server enforces separation-of-duties: the APPROVER principal must
-- differ from the INITIATOR principal (see ApprovalStore.approve →
-- SelfApprovalError). Until now the initiator identity lived only in the
-- in-memory ApprovalStore, so it VANISHED on gateway restart and was
-- invisible across replicas — the durable Postgres-backed store needs a
-- column to persist it.
--
-- Adds a NULLABLE `initiated_by` column. Nullable is backfill-safe:
-- historical rows (which pre-date the durable store and are all already
-- terminal) read NULL, and the store treats a NULL initiator as "no
-- self-approval constraint recoverable" — it still enforces SoD for
-- every row the durable store itself created (initiated_by populated at
-- insert). Never edits shipped 0121.
--
-- Idempotent (ADD COLUMN IF NOT EXISTS). Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit after
-- merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

ALTER TABLE oauth_action_approvals
  ADD COLUMN IF NOT EXISTS initiated_by text;

COMMENT ON COLUMN oauth_action_approvals.initiated_by IS
  'Canonical identity of the principal that INITIATED the action. Load-bearing for four-eye separation-of-duties: the approver must be a DIFFERENT principal. NULL only for pre-0375 historical rows.';

COMMIT;
