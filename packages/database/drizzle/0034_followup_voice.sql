-- =============================================================================
-- Migration 0034 — Daily Follow-up + Persona Voice schema (Wave M2)
--
-- Companion to Docs/DESIGN/DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md.
-- Adds three tenant-scoped tables forming the owner-facing daily
-- nudge engine + the guide-vs-learn voice toggle:
--
--   1. followup_candidates   — queue of proactive follow-ups Mr.
--                              Mwikila has either scheduled, sent,
--                              dismissed, or let expire.
--                              Tenant-scoped, RLS.
--   2. followup_preferences  — per-user channel + quiet-hours + daily
--                              cap. Primary key is (tenant_id, user_id).
--                              Tenant-scoped, RLS.
--   3. persona_voice_mode    — per-user voice mode (guide / learn /
--                              balanced) + verbosity dial. Primary key
--                              is (tenant_id, user_id). Tenant-scoped,
--                              RLS.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration
-- 0003. Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. followup_candidates — owner-facing proactive nudge queue
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS followup_candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  user_id         text NOT NULL,
  /** Origin of this candidate — work_cycle | anticipatory | regulator |
      user_flag | relationship_dormancy | incident_postmortem. */
  source          text NOT NULL,
  /** Free-form structured payload. Caller-side shape:
      { text: string, citations: [{...}], action?: {...} }. */
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Computed priority in [0, 1]. Recomputed at every scheduler tick. */
  priority        real NOT NULL DEFAULT 0,
  /** Preferred channel — inapp | email | whatsapp. */
  channel         text NOT NULL DEFAULT 'inapp',
  /** When the scheduler intends to dispatch — already adjusted for
      quiet hours + user timezone. */
  scheduled_for   timestamptz NOT NULL,
  /** Dispatch lifecycle — pending | sent | dismissed | expired. */
  status          text NOT NULL DEFAULT 'pending',
  sent_at         timestamptz,
  audit_hash      text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT followup_status_chk CHECK (status IN (
    'pending','sent','dismissed','expired'
  )),
  CONSTRAINT followup_channel_chk CHECK (channel IN (
    'inapp','email','whatsapp'
  )),
  CONSTRAINT followup_priority_range CHECK (
    priority >= 0 AND priority <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_followup_user_pending
  ON followup_candidates (tenant_id, user_id, scheduled_for)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_followup_tenant_due
  ON followup_candidates (tenant_id, scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_followup_user_history
  ON followup_candidates (tenant_id, user_id, created_at DESC);

ALTER TABLE followup_candidates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'followup_candidates'
       AND policyname = 'followup_candidates_tenant_isolation'
  ) THEN
    CREATE POLICY followup_candidates_tenant_isolation ON followup_candidates
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. followup_preferences — per-user channel + quiet-hours + daily cap
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS followup_preferences (
  tenant_id          text NOT NULL,
  user_id            text NOT NULL,
  /** Channels the user has consented to. PostgreSQL array of channel
      strings; empty array means "fully muted". */
  allowed_channels   text[] NOT NULL DEFAULT ARRAY['inapp']::text[],
  /** Local-time start of quiet-hours window (e.g. '22:00'). */
  quiet_hours_start  time NOT NULL DEFAULT '22:00:00',
  /** Local-time end of quiet-hours window (e.g. '07:00'). */
  quiet_hours_end    time NOT NULL DEFAULT '07:00:00',
  /** Daily cap on non-critical follow-ups. Regulator-deadline items
      with T-3 or sooner bypass this cap (see spec §13). */
  max_per_day        int NOT NULL DEFAULT 5,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT followup_prefs_max_per_day_range CHECK (
    max_per_day >= 0 AND max_per_day <= 50
  )
);

ALTER TABLE followup_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'followup_preferences'
       AND policyname = 'followup_preferences_tenant_isolation'
  ) THEN
    CREATE POLICY followup_preferences_tenant_isolation ON followup_preferences
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. persona_voice_mode — per-user voice mode + verbosity dial
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS persona_voice_mode (
  tenant_id        text NOT NULL,
  user_id          text NOT NULL,
  /** Voice mode — guide | learn | balanced (default). */
  mode             text NOT NULL DEFAULT 'balanced',
  /** Verbosity dial from 1 (terse) to 5 (most verbose). The default
      (2) is conservative for new tenants; mastery-tier heuristics
      may suggest 3+ for novice surfaces. */
  verbosity_level  int NOT NULL DEFAULT 2,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT persona_voice_mode_chk CHECK (mode IN (
    'guide','learn','balanced'
  )),
  CONSTRAINT persona_voice_verbosity_range CHECK (
    verbosity_level >= 1 AND verbosity_level <= 5
  )
);

ALTER TABLE persona_voice_mode ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'persona_voice_mode'
       AND policyname = 'persona_voice_mode_tenant_isolation'
  ) THEN
    CREATE POLICY persona_voice_mode_tenant_isolation ON persona_voice_mode
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
