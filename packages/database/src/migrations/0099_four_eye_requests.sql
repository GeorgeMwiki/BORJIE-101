-- =============================================================================
-- Migration 0099 — Four-Eye Approval Requests (Wave FOUR-EYE-APPROVAL)
--
-- Companion to:
--   - services/api-gateway/src/routes/owner/four-eye-approvals.hono.ts
--   - services/api-gateway/src/services/four-eye/*
--
-- Captures every high-stakes action that requires two-person approval
-- before execution. Examples: payment over 5M TZS, regulator filing,
-- contract signature. The requester (owner) initiates; a tokenised
-- approval URL is delivered to the second approver out-of-band via
-- the reminders dispatcher (email + Slack). On approval the original
-- action is dispatched through the matching brain tool. Every state
-- change is hash-chained into ai_audit_chain via the brain's existing
-- chain primitive.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern. RLS is FORCE-enabled per the Borjie hard rule
-- (`CLAUDE.md`).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS four_eye_requests (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text        NOT NULL,
  /** Supabase user id of the owner who initiated the request. */
  requester_id          text        NOT NULL,
  /** Supabase user id of the second approver (resolved at create time). */
  second_approver_id    text,
  /** Logical action category, e.g. payment, regulator_filing, contract_signature. */
  action_type           text        NOT NULL,
  /** Action payload — interpreted by the matching brain tool on approval. */
  payload               jsonb       NOT NULL,
  /** Tokenised public link the approver clicks. Bcrypt-equivalent length. */
  approval_token        text        NOT NULL,
  /** Lifecycle: pending → approved | rejected | expired | executed. */
  status                text        NOT NULL DEFAULT 'pending',
  /** Optional note from the second approver. */
  decision_note         text,
  /** UTC time at which an un-acted request auto-expires. */
  expires_at            timestamptz NOT NULL,
  decided_at            timestamptz,
  executed_at           timestamptz,
  /** Free-form result returned by the executed brain tool. */
  execution_result      jsonb,
  /** Hash-chain audit pointers — written on create / decide / execute. */
  audit_create_id       uuid,
  audit_decide_id       uuid,
  audit_execute_id      uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT four_eye_requests_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed')),
  CONSTRAINT four_eye_requests_action_chk
    CHECK (action_type IN (
      'payment',
      'regulator_filing',
      'contract_signature',
      'asset_disposition',
      'workforce_termination',
      'other'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS four_eye_requests_token_uniq
  ON four_eye_requests (approval_token);

CREATE INDEX IF NOT EXISTS four_eye_requests_tenant_idx
  ON four_eye_requests (tenant_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS four_eye_requests_requester_idx
  ON four_eye_requests (tenant_id, requester_id, created_at DESC);

CREATE INDEX IF NOT EXISTS four_eye_requests_approver_idx
  ON four_eye_requests (tenant_id, second_approver_id, status)
  WHERE second_approver_id IS NOT NULL;

ALTER TABLE four_eye_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE four_eye_requests FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'four_eye_requests'
       AND policyname = 'four_eye_requests_tenant_isolation'
  ) THEN
    CREATE POLICY four_eye_requests_tenant_isolation
      ON four_eye_requests
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
