-- =============================================================================
-- DOWN 0356 — reverse mining_escalations org-field consolidation (TZ3)
--
-- Reverses migration 0356 by dropping the additive `context` jsonb column.
-- (0356 is additive-only — no backfill — so the reverse is a single DROP.)
--
-- DATA LOSS: drops the lossless org-path context bag on any escalations the
-- repointed agentic writer created. Dev/staging rollback ONLY; not for prod.
--
-- Idempotent: DROP COLUMN IF EXISTS is a no-op when already dropped.
-- =============================================================================

BEGIN;

ALTER TABLE mining_escalations
  DROP COLUMN IF EXISTS context;

COMMIT;
