-- ─────────────────────────────────────────────────────────────────────
-- Migration 0164 — Zero-friction MD onboarding sessions (Wave-3 task #14).
--
-- Backs `services/onboarding-orchestrator`. Conversational slot-fill
-- state persists across days (WhatsApp is async). Sessions begin
-- BEFORE a tenant row exists (tenant_id NULL), then link once the
-- bootstrapper commits.
--
-- Research: `.audit/litfin-sota-2026-05-23/20-zero-friction-onboarding.md`
-- §12 (architecture) and §14.1 (service scope).
--
-- Layout:
--   * `onboarding_sessions`   — one row per attempt; survives reconnects.
--   * RLS:                     enforced by tenant_id WHERE PRESENT.
--                              Pre-tenant rows readable by the
--                              `started_by_user_id` (anonymous users
--                              get a per-session bearer; sessions
--                              owned by NULL user_id are queryable
--                              only by service role).
--   * `onboarding_session_events` — append-only transcript + audit.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /** NULL until bootstrap commits. */
  tenant_id           UUID,
  /** NULL when the channel is anonymous (WhatsApp first message). */
  started_by_user_id  UUID,
  /** 'web' | 'whatsapp' | 'voice' | 'email' */
  channel             TEXT NOT NULL,
  /** BCP-47 language tag (e.g. 'sw-KE', 'en-KE', 'lg-UG'). Auto-detected on turn 1. */
  locale              TEXT NOT NULL DEFAULT 'en-KE',
  /** 'open' | 'awaiting_user' | 'awaiting_confirm' | 'bootstrapping' | 'committed' | 'abandoned' | 'rolled_back' */
  status              TEXT NOT NULL DEFAULT 'open',
  /** Filled slots so far. Schema = packages/.../slot-schema.ts SlotState. */
  slots               JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** Append-only message log (text/file/voice). */
  transcript          JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** Idempotent ChangeSet computed at confirm; replayed by bootstrapper. */
  blueprint           JSONB,
  /** Used by info-gain ranker — fixed budget per tier. */
  interview_budget    INTEGER NOT NULL DEFAULT 12,
  turns_used          INTEGER NOT NULL DEFAULT 0,
  /** Free-tier identity binding before tenant exists (WhatsApp number or web bearer). */
  external_handle     TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  rolled_back_at      TIMESTAMPTZ,
  CONSTRAINT onboarding_sessions_channel_chk
    CHECK (channel IN ('web', 'whatsapp', 'voice', 'email')),
  CONSTRAINT onboarding_sessions_status_chk
    CHECK (status IN ('open', 'awaiting_user', 'awaiting_confirm',
                      'bootstrapping', 'committed', 'abandoned',
                      'rolled_back')),
  CONSTRAINT onboarding_sessions_budget_chk
    CHECK (interview_budget BETWEEN 1 AND 200),
  CONSTRAINT onboarding_sessions_turns_chk
    CHECK (turns_used >= 0 AND turns_used <= interview_budget * 5)
);

CREATE INDEX IF NOT EXISTS idx_onb_sessions_tenant
  ON onboarding_sessions (tenant_id) WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_onb_sessions_user
  ON onboarding_sessions (started_by_user_id) WHERE started_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_onb_sessions_handle
  ON onboarding_sessions (external_handle) WHERE external_handle IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_onb_sessions_status
  ON onboarding_sessions (status, last_activity_at);

-- ─────────────────────────────────────────────────────────────────────
-- Append-only event log per session (audit + replay).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onboarding_session_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
  /** 'message_in' | 'message_out' | 'slot_filled' | 'extract_attempt' |
   *  'confirm_proposed' | 'confirm_accepted' | 'bootstrap_step' |
   *  'bootstrap_committed' | 'rollback' | 'error' */
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** SHA-256 idempotency key derived from (session_id, step_name, ...). */
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT onb_events_type_chk
    CHECK (event_type IN ('message_in', 'message_out', 'slot_filled',
                          'extract_attempt', 'confirm_proposed',
                          'confirm_accepted', 'bootstrap_step',
                          'bootstrap_committed', 'rollback', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_onb_events_session
  ON onboarding_session_events (session_id, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_onb_events_idempotency
  ON onboarding_session_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security.
--   * Service role bypasses (writes from the orchestrator).
--   * Tenants see only their own rows once linked.
--   * Pre-tenant rows are NOT visible via tenant role; the service
--     role is the only path that touches them.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE onboarding_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_session_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onb_sessions_tenant_isolation ON onboarding_sessions;
CREATE POLICY onb_sessions_tenant_isolation ON onboarding_sessions
  FOR ALL
  USING (
    tenant_id IS NOT NULL
    AND tenant_id::text = current_setting('app.current_tenant_id', true)
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id::text = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS onb_events_tenant_isolation ON onboarding_session_events;
CREATE POLICY onb_events_tenant_isolation ON onboarding_session_events
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM onboarding_sessions s
      WHERE s.id = onboarding_session_events.session_id
        AND s.tenant_id IS NOT NULL
        AND s.tenant_id::text = current_setting('app.current_tenant_id', true)
    )
  );
