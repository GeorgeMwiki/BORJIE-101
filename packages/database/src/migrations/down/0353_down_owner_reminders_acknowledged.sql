-- =============================================================================
-- Down-migration 0353 — narrow the reminders CHECK constraints back to 0089.
--
-- Dev/staging ONLY. Reverses 0353_owner_reminders_acknowledged.sql by
-- restoring the original migration-0089 value sets for reminders_status_chk
-- and reminders_channel_chk.
--
-- WARNING: this RE-NARROWS the allowed sets. If any row currently holds a
-- value that 0353 added ('sending' / 'acknowledged' status, 'calendar' /
-- 'whatsapp' channel) the ADD CONSTRAINT will FAIL — those rows must be
-- migrated/cleared first. On LIVE this would also re-break the worker claim
-- (which writes 'sending') and the SLICE A2 acknowledge / whatsapp paths, so
-- do NOT run against production. No money / licence / ledger records touched.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'reminders'
  ) THEN
    ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_status_chk;
    ALTER TABLE reminders
      ADD CONSTRAINT reminders_status_chk
      CHECK (status IN ('scheduled', 'sent', 'failed', 'cancelled'));

    ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_channel_chk;
    ALTER TABLE reminders
      ADD CONSTRAINT reminders_channel_chk
      CHECK (channel IN ('email', 'sms', 'slack'));
  END IF;
END $$;

COMMIT;
