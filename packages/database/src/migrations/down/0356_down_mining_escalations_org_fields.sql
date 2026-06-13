-- =============================================================================
-- DOWN 0356 — reverse mining_escalations org-field consolidation (TZ3)
--
-- Reverses migration 0356:
--   (1) Deletes rows that the one-time backfill lifted in from org_escalations,
--       identified by the `context->>'orgPath' = 'true'` marker the up-migration
--       stamps. Native escalations (raised through the route/UI, no orgPath
--       marker) are UNTOUCHED.
--   (2) Drops the additive `context` column.
--
-- DATA LOSS: yes — removes the backfilled org-origin escalations and the
-- context bag on any escalations the repointed agentic writer created.
-- Dev/staging rollback ONLY. Never run in production.
--
-- Idempotent: DELETE is a filtered no-op when no marked rows remain; DROP
-- COLUMN IF EXISTS is a no-op when already dropped.
-- =============================================================================

BEGIN;

-- (1) Remove backfilled / org-path rows (only when the column still exists).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'mining_escalations'
       AND column_name = 'context'
  ) THEN
    DELETE FROM mining_escalations
     WHERE context ->> 'orgPath' = 'true';
  END IF;
END $$;

-- (2) Drop the additive column.
ALTER TABLE mining_escalations
  DROP COLUMN IF EXISTS context;

COMMIT;
