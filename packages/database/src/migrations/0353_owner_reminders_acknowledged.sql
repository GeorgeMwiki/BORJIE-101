-- =============================================================================
-- Migration 0353 — owner reminders: 'acknowledged' status + 'whatsapp' channel
-- (SLICE A2 — reminders loop).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Two reminder-domain CHECK constraints from migration 0089 had drifted
-- BEHIND the schema + the workers that write the table:
--
--   1. reminders_status_chk allowed only
--      ('scheduled','sent','failed','cancelled') — but
--        * the reminders-dispatch + calendar-sync workers atomically claim
--          rows by flipping them to 'sending' (an in-flight state), and
--        * SLICE A2 adds 'acknowledged' for the no-reminder-slips loop:
--          the owner POSTs /:id/acknowledge to confirm a fired reminder,
--          which also doubles as the terminal state an escalated reminder
--          lands in once it has been surfaced loudly.
--
--   2. reminders_channel_chk allowed only ('email','sms','slack') — but
--        * the calendar-sync worker writes channel='calendar', and
--        * SLICE A2 adds 'whatsapp' as a first-class reminder channel
--          (the Twilio SMS provider already routes a whatsapp rail).
--
-- This migration WIDENS both CHECK constraints to the full set the schema
-- (packages/database/src/schemas/owner-reminders.schema.ts) now declares.
-- It is purely ADDITIVE (it only ever broadens the allowed value sets — no
-- existing value is forbidden, so no row can be invalidated).
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): the table itself is
-- guarded by IF EXISTS, and each constraint is dropped IF EXISTS then
-- re-created with the widened set, so a re-run is a pure no-op and a fresh
-- apply (after 0089) lands the correct constraint. References only the
-- pre-existing `reminders` table (migration 0089). Immutable + forward-only.
--
-- Companion files:
--   * packages/database/src/schemas/owner-reminders.schema.ts
--   * services/api-gateway/src/routes/owner/reminders.hono.ts
--   * services/api-gateway/src/workers/reminders-dispatch.worker.ts
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'reminders'
  ) THEN
    -- Status: scheduled → sending → sent → acknowledged | failed | cancelled.
    ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_status_chk;
    ALTER TABLE reminders
      ADD CONSTRAINT reminders_status_chk
      CHECK (status IN (
        'scheduled',
        'sending',
        'sent',
        'acknowledged',
        'failed',
        'cancelled'
      ));

    -- Channels: email | sms | slack | calendar | whatsapp.
    ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_channel_chk;
    ALTER TABLE reminders
      ADD CONSTRAINT reminders_channel_chk
      CHECK (channel IN (
        'email',
        'sms',
        'slack',
        'calendar',
        'whatsapp'
      ));
  END IF;
END $$;

COMMIT;
