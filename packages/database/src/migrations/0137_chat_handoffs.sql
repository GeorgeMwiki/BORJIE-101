-- =============================================================================
-- Migration 0137 - Chat handoffs (Wave KNOWLEDGE-HANDOFF)
--
-- Companion to:
--   - packages/central-intelligence/src/handoff/
--   - services/api-gateway/src/routes/owner/handoff.hono.ts
--   - apps/{owner-web,workforce-mobile,buyer-mobile}/src/components/chat/HandoffCard.tsx
--   - Docs/RESEARCH/KNOWLEDGE_HANDOFF_SOTA_2026-05-29.md
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- When the owner types something like
--   "@Manager-John please follow up on Mwadui site safety"
-- in their cockpit chat, the brain emits a
--   <chat_handoff target_user_id="..." target_role="manager" topic="..."/>
-- SSE tag. The api-gateway parses + persists a row in this table,
-- fires a notification to the target's mobile, and bubbles the target's
-- reply back to the source chat as a reply card.
--
-- Tenant isolation: every row carries `tenant_id`. RLS FORCE-enabled
-- per the Borjie hard rule (CLAUDE.md). Cross-tenant denial is
-- enforced at the route layer too — even within a tenant, the brain
-- cannot route a handoff to a user whose RLS scope does not cover the
-- supplied scope payload.
--
-- Audit chain: every handoff is hash-chained via the same chain
-- primitive used by `ai_audit_chain` / `decisions` so an auditor can
-- replay verifyChain() over any tenant slice.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── chat_handoffs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_handoffs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  /** The chat session the handoff originated in (owner cockpit, worker
   *  mobile, etc.) — used so the reply card can bubble back to the right
   *  session. */
  source_session_id   text        NOT NULL,
  /** Originator (the actor who triggered the handoff via the brain). */
  source_user_id      text        NOT NULL,
  /** Recipient (resolved by the entity-index name lookup performed by
   *  the brain). */
  target_user_id      text        NOT NULL,
  /** Persona slug of the recipient role at handoff time
   *  (T3_module_manager / T4_field_employee / T5_customer_concierge / ...). */
  target_role         text        NOT NULL,
  /** Free-form 1-sentence topic ("Mwadui site safety follow-up"). */
  topic               text        NOT NULL,
  /** Scope ids and structured context the recipient needs to act —
   *  e.g. {"siteIds":["mwadui"],"category":"safety","sourceTurnId":"..."}. */
  scope_payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** When the recipient acted on the handoff (replied / closed / ignored).
   *  NULL until acted on. */
  resolved_at         timestamptz,
  /** How the recipient resolved it: replied / closed / declined. */
  resolution          text,
  /** The reply text the recipient produced (if any). Surfaced back to the
   *  source as a reply card. */
  reply_text          text,
  /** Sequence id for audit-chain ordering within the tenant. */
  audit_chain_seq     bigint      NOT NULL,
  entry_hash          text        NOT NULL,
  prev_hash           text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chat_handoffs_target_role_chk'
  ) THEN
    ALTER TABLE chat_handoffs
      ADD CONSTRAINT chat_handoffs_target_role_chk
      CHECK (target_role IN (
        'T1_owner_strategist',
        'T2_admin_strategist',
        'T3_module_manager',
        'T4_field_employee',
        'T5_customer_concierge',
        'T_auditor',
        'T_vendor'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chat_handoffs_resolution_chk'
  ) THEN
    ALTER TABLE chat_handoffs
      ADD CONSTRAINT chat_handoffs_resolution_chk
      CHECK (resolution IS NULL OR resolution IN ('replied', 'closed', 'declined'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chat_handoffs_no_self_loop_chk'
  ) THEN
    ALTER TABLE chat_handoffs
      ADD CONSTRAINT chat_handoffs_no_self_loop_chk
      CHECK (source_user_id <> target_user_id);
  END IF;
END $$;

-- Hot path: "what handoffs has this user received?" — recipient inbox.
CREATE INDEX IF NOT EXISTS chat_handoffs_recipient_inbox_idx
  ON chat_handoffs (tenant_id, target_user_id, created_at DESC);

-- Hot path: "what handoffs did this session emit?" — source-chat reply lookup.
CREATE INDEX IF NOT EXISTS chat_handoffs_source_session_idx
  ON chat_handoffs (tenant_id, source_session_id, created_at DESC);

-- Hot path: open-handoff queue (not yet resolved).
CREATE INDEX IF NOT EXISTS chat_handoffs_open_recipient_idx
  ON chat_handoffs (tenant_id, target_user_id, created_at DESC)
  WHERE resolved_at IS NULL;

-- Audit chain verifier hot path.
CREATE INDEX IF NOT EXISTS chat_handoffs_tenant_seq_idx
  ON chat_handoffs (tenant_id, audit_chain_seq);

ALTER TABLE chat_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_handoffs FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'chat_handoffs'
       AND policyname = 'chat_handoffs_tenant_isolation'
  ) THEN
    CREATE POLICY chat_handoffs_tenant_isolation
      ON chat_handoffs
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
