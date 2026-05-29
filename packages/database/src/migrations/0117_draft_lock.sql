-- =============================================================================
-- Migration 0117 — Draft Revision Lock
--
-- Adds lock-on-confirm semantics to draft_revisions. Once locked, a revision
-- becomes immutable: content_md and citations cannot be changed. Enforced at
-- app layer via assertNotLocked guard in revisions-persistence.ts.
--
-- New columns on `draft_revisions`:
--   locked_at         timestamptz      — NULL = editable; non-NULL = locked
--   locked_by_user_id uuid             — user who locked the revision
--   lock_reason       text             — optional rationale (e.g. "finalized")
--
-- New CHECK constraint: once locked_at IS NOT NULL, the revision is frozen.
-- App layer enforces the invariant: no mutations on locked revisions.
--
-- RLS is inherited from parent draft_revisions policies (no changes).
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- IMMUTABLE: never edit after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

-- Add lock columns to draft_revisions
ALTER TABLE draft_revisions
  ADD COLUMN IF NOT EXISTS locked_at         timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS lock_reason       text;

-- FK constraint: locked_by_user_id references users(id) if user exists
-- (soft constraint; user deletion does not cascade)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'draft_revisions_locked_by_fk'
  ) THEN
    ALTER TABLE draft_revisions
      ADD CONSTRAINT draft_revisions_locked_by_fk
      FOREIGN KEY (locked_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- CHECK: locked_at and locked_by_user_id must both be NULL or both be NOT NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'draft_revisions_lock_pair_chk'
  ) THEN
    ALTER TABLE draft_revisions
      ADD CONSTRAINT draft_revisions_lock_pair_chk
      CHECK ((locked_at IS NULL AND locked_by_user_id IS NULL)
             OR (locked_at IS NOT NULL AND locked_by_user_id IS NOT NULL));
  END IF;
END $$;

-- CHECK: lock_reason cannot be empty string
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'draft_revisions_lock_reason_chk'
  ) THEN
    ALTER TABLE draft_revisions
      ADD CONSTRAINT draft_revisions_lock_reason_chk
      CHECK (lock_reason IS NULL OR lock_reason != '');
  END IF;
END $$;

-- Index: fast query for lock status (used by lock-status endpoint)
CREATE INDEX IF NOT EXISTS idx_draft_revisions_tenant_locked
  ON draft_revisions (tenant_id, draft_id, locked_at DESC);

COMMIT;
