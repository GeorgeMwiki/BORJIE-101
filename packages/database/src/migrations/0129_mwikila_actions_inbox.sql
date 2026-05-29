-- =============================================================================
-- Migration 0129 — Mwikila actions inbox (autonomous-MD acting on behalf)
--
-- Every autonomous action lands here. The owner cockpit's
-- "Acting on your behalf" inbox renders the table; one-tap approve or
-- reverse drives the lifecycle.
--
-- action_kind: domain-specific verb identifying the handler.
--   shifts.weekly_schedule_draft
--   payroll.monthly_batch_prep
--   royalty.monthly_filing_prep
--   license.renewal_reminder
--   marketplace.counter_offer
--   (more added as handlers ship)
--
-- status lifecycle:
--   proposed             T0/T1: Mr. Mwikila has a draft; owner has not acted.
--   owner_approved       T0/T1: owner approved; Mwikila is executing.
--   owner_denied         T0/T1: owner denied; action will not execute.
--   executed             T2/T3: Mwikila executed; T2 still reversible.
--   reversed             T2: owner reversed within the window.
--   committed            T2/T3: reversal window passed; final.
--   blocked_by_inviolable inviolable rail blocked the action; no-op.
--   expired              T0/T1: owner did not act within proposal_ttl.
--
-- delegation_tier: T0..T3 — the tier the action ran under.
-- reversal_token + reversal_until: T2 reversibility window.
-- payload (jsonb): handler-specific payload for execute + reverse.
-- rationale: bilingual sw+en text explaining the action.
--
-- Tenant scope:
--   RLS FORCE per CLAUDE.md hard rule.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS mwikila_actions_inbox (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Owner the action is being taken on behalf of. Always the tenant
  -- owner; carried explicitly for forensic replay.
  acting_on_user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_kind           TEXT NOT NULL,
  category              TEXT NOT NULL,
  delegation_tier       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'proposed',
  summary               TEXT NOT NULL,
  summary_sw            TEXT NOT NULL,
  rationale             TEXT NOT NULL,
  -- Handler-specific payload — executor and reverse handler both read it.
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Reversibility (T2 only). reversal_token is a one-time UUID the
  -- owner-web inbox surfaces with a countdown clock.
  reversal_token        UUID,
  reversal_until        TIMESTAMPTZ,
  -- Lifecycle timestamps.
  proposed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proposal_ttl_at       TIMESTAMPTZ,
  executed_at           TIMESTAMPTZ,
  owner_reviewed_at     TIMESTAMPTZ,
  owner_reviewed_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  reversed_at           TIMESTAMPTZ,
  committed_at          TIMESTAMPTZ,
  -- Audit hash chain stitching.
  audit_chain_hash      TEXT,
  decision_id           UUID,
  -- Inviolable rail block reason (only set when status='blocked_by_inviolable').
  blocked_reason        TEXT,
  provenance            JSONB NOT NULL DEFAULT '{"via":"mwikila"}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT mwikila_actions_inbox_tier_check CHECK (
    delegation_tier IN ('T0', 'T1', 'T2', 'T3')
  ),
  CONSTRAINT mwikila_actions_inbox_status_check CHECK (
    status IN (
      'proposed',
      'owner_approved',
      'owner_denied',
      'executed',
      'reversed',
      'committed',
      'blocked_by_inviolable',
      'expired'
    )
  ),
  CONSTRAINT mwikila_actions_inbox_category_check CHECK (
    category IN (
      'shifts',
      'payroll-prep',
      'royalty-filing',
      'license-renewal-reminders',
      'contract-followups',
      'worker-hires',
      'worker-discipline',
      'capex',
      'inventory-orders',
      'compliance-filings',
      'marketplace-bids',
      'marketplace-counters'
    )
  ),
  -- reversal_token + reversal_until ride together (both or neither).
  CONSTRAINT mwikila_actions_inbox_reversal_pair_check CHECK (
    (reversal_token IS NULL AND reversal_until IS NULL) OR
    (reversal_token IS NOT NULL AND reversal_until IS NOT NULL)
  )
);

-- Owner inbox query: list pending / recent by tenant.
CREATE INDEX IF NOT EXISTS mwikila_actions_inbox_tenant_status_idx
  ON mwikila_actions_inbox (tenant_id, status, proposed_at DESC);

CREATE INDEX IF NOT EXISTS mwikila_actions_inbox_tenant_category_idx
  ON mwikila_actions_inbox (tenant_id, category, proposed_at DESC);

-- Reversal window sweep — find rows whose reversal_until just elapsed
-- so the worker can transition them from executed -> committed.
CREATE INDEX IF NOT EXISTS mwikila_actions_inbox_reversal_due_idx
  ON mwikila_actions_inbox (reversal_until)
  WHERE status = 'executed' AND reversal_until IS NOT NULL;

-- TTL sweep — proposed actions that the owner ignored past the TTL.
CREATE INDEX IF NOT EXISTS mwikila_actions_inbox_ttl_due_idx
  ON mwikila_actions_inbox (proposal_ttl_at)
  WHERE status = 'proposed' AND proposal_ttl_at IS NOT NULL;

-- Reversal token lookup (one-time UUID used by POST /:id/reverse).
CREATE UNIQUE INDEX IF NOT EXISTS mwikila_actions_inbox_reversal_token_unique
  ON mwikila_actions_inbox (reversal_token)
  WHERE reversal_token IS NOT NULL;

ALTER TABLE mwikila_actions_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE mwikila_actions_inbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mwikila_actions_inbox_tenant_isolation
  ON mwikila_actions_inbox;

CREATE POLICY mwikila_actions_inbox_tenant_isolation
  ON mwikila_actions_inbox
  USING (tenant_id::text = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));

COMMENT ON TABLE mwikila_actions_inbox IS
  'Mr. Mwikila autonomous-MD actions inbox. Every proposal / execution / '
  'reversal lands here. Owner cockpit "Acting on your behalf" page renders '
  'this table with one-tap approve / deny / reverse + reversal-window countdown.';

COMMIT;
