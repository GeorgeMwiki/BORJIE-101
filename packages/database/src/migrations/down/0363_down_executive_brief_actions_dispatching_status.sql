-- Down 0363 — revert the executive_brief_actions status CHECK to the original set.
-- Dev/staging only. FAILS if any row currently holds status='dispatching'
-- (clear those first). Guarded + idempotent.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.executive_brief_actions') IS NOT NULL THEN
    ALTER TABLE executive_brief_actions
      DROP CONSTRAINT IF EXISTS executive_brief_actions_status_chk;
    ALTER TABLE executive_brief_actions
      ADD CONSTRAINT executive_brief_actions_status_chk
      CHECK (status = ANY (ARRAY[
        'pending', 'approved', 'executed', 'failed', 'rejected'
      ]));
  END IF;
END $$;
COMMIT;
