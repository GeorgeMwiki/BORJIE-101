-- =============================================================================
-- Migration 0077 — Pilot Feedback (Wave PILOT-HITL)
--
-- Companion to:
--   - services/api-gateway/src/routes/pilot-feedback.hono.ts
--   - apps/workforce-mobile/src/components/FeedbackButton.tsx
--   - apps/owner-web/src/components/FeedbackButton.tsx
--   - apps/admin-web/src/components/FeedbackButton.tsx
--   - Docs/PILOT_RUNBOOK.md
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- One table:
--
--   pilot_feedback — one row per in-app "Niarifu Borjie" submission
--                    from the 3–5 pilot cohort. Captures a 1–5 star
--                    rating, free-text message, originating screen id,
--                    and a free-form session_context jsonb (network,
--                    persona, last-action, etc.) so the co-located
--                    observer can correlate the rating with a moment.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern from migration 0003 (re-used throughout the codebase).
-- Pilots only ever read their own rows; the Borjie team reads everything
-- via a service-role bypass.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- pilot_feedback — in-app feedback submissions during the pilot window
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pilot_feedback (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  /** 1 = "I hated it", 5 = "loved it". Same convention as the in-app stars. */
  rating          integer     NOT NULL,
  /** Free-text message — Swahili or English. PII-free per the runbook;
      observers are trained not to enter names, phones, or amounts. */
  message         text        NOT NULL,
  /** Originating screen id (e.g. 'W-DASH-01', 'O-M-03'). Optional —
      observers may submit feedback from a global widget without a screen. */
  screen_id       text,
  /** Free-form structured context (network mode, last action, persona,
      offline-recovered flag). Used by support to correlate the rating
      with what was on screen. */
  session_context jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pilot_feedback_rating_chk'
  ) THEN
    ALTER TABLE pilot_feedback
      ADD CONSTRAINT pilot_feedback_rating_chk
      CHECK (rating BETWEEN 1 AND 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pilot_feedback_message_nonempty_chk'
  ) THEN
    ALTER TABLE pilot_feedback
      ADD CONSTRAINT pilot_feedback_message_nonempty_chk
      CHECK (length(message) > 0);
  END IF;
END $$;

-- Hot path: list a tenant's feedback newest first for the pilot dashboard.
CREATE INDEX IF NOT EXISTS idx_pilot_feedback_tenant_created
  ON pilot_feedback (tenant_id, created_at DESC);

-- Per-user history within a tenant (which pilot is hitting issues most).
CREATE INDEX IF NOT EXISTS idx_pilot_feedback_tenant_user
  ON pilot_feedback (tenant_id, user_id, created_at DESC);

-- Per-screen rollups (which screens are pilots complaining about).
CREATE INDEX IF NOT EXISTS idx_pilot_feedback_tenant_screen
  ON pilot_feedback (tenant_id, screen_id, created_at DESC);

ALTER TABLE pilot_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'pilot_feedback'
       AND policyname = 'pilot_feedback_tenant_isolation'
  ) THEN
    CREATE POLICY pilot_feedback_tenant_isolation
      ON pilot_feedback
      FOR ALL
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
