-- =============================================================================
-- Down-migration 0326 — reverse the Capability Gap Register extension.
--
-- Dev/staging only. Drops the four net-new gap columns, the gap_kind CHECK,
-- and the gap-open partial index from md_commitments. The base table (the GTD
-- commitment ledger, migration 0321) and its RLS FORCE policies are LEFT INTACT
-- — this down only reverses the additive 0326 columns. The fail-safe
-- consequence is benign: with the gap columns gone the GapRegistryWatcher reads
-- zero non-NULL gap_kind rows (the watcher treats an absent column exactly like
-- an empty gap backlog) and the brain falls back to pre-gap behaviour.
--
-- Reverses migration 0326_capability_gap_register.sql.
-- =============================================================================

BEGIN;

DROP INDEX IF EXISTS md_commitments_gap_open_idx;

ALTER TABLE md_commitments
  DROP CONSTRAINT IF EXISTS md_commitments_gap_kind_chk;

-- Restore the original (0321) status CHECK domain: drop the two terminal gap
-- states (needs_approval | dead_letter) re-added by 0326. Any row still carrying
-- a terminal gap status must be cleared before reversing in dev/staging.
ALTER TABLE md_commitments
  DROP CONSTRAINT IF EXISTS md_commitments_status_chk;
ALTER TABLE md_commitments
  ADD CONSTRAINT md_commitments_status_chk CHECK (
    status IN ('open', 'scheduled', 'overdue', 'blocked', 'done', 'reopened')
  );

ALTER TABLE md_commitments DROP COLUMN IF EXISTS attempt_failed_count;
ALTER TABLE md_commitments DROP COLUMN IF EXISTS gap_audit_seq;
ALTER TABLE md_commitments DROP COLUMN IF EXISTS gap_kind;
ALTER TABLE md_commitments DROP COLUMN IF EXISTS blocked_by;
ALTER TABLE md_commitments DROP COLUMN IF EXISTS unblock_trigger;
ALTER TABLE md_commitments DROP COLUMN IF EXISTS competence_domain;

COMMIT;
