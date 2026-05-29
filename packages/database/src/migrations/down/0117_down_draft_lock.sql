-- Down migration for 0117_draft_lock.sql
-- Removes lock-on-confirm columns + constraints from draft_revisions

BEGIN;

-- Drop constraints (safe if not present)
ALTER TABLE draft_revisions
  DROP CONSTRAINT IF EXISTS draft_revisions_locked_by_fk,
  DROP CONSTRAINT IF EXISTS draft_revisions_lock_pair_chk,
  DROP CONSTRAINT IF EXISTS draft_revisions_lock_reason_chk;

-- Drop index
DROP INDEX IF EXISTS idx_draft_revisions_tenant_locked;

-- Drop columns
ALTER TABLE draft_revisions
  DROP COLUMN IF EXISTS locked_at,
  DROP COLUMN IF EXISTS locked_by_user_id,
  DROP COLUMN IF EXISTS lock_reason;

COMMIT;
