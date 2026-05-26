-- =============================================================================
-- Migration 0030 — Swarm Coordination (Wave 18HH)
--
-- Spec: Docs/DESIGN/AGENT_SWARM_COORDINATION_SOTA.md
--
-- Adds the spatial-coordination substrate for the Borjie agent swarm:
-- every running Mr. Mwikila instance (root MD, district MD,
-- specialisations, spawned waves, background workers) registers, can
-- send A2A messages to peers, can post intermediate work to a shared
-- blackboard, and conflicts between contradicting mutation proposals
-- are recorded and routed for reconciliation.
--
-- Four tables:
--   1. active_agents          — real-time registry of running agents.
--   2. agent_messages         — A2A push channel (direct / broadcast /
--                                subject-scoped).
--   3. blackboard_postings    — shared pull workspace (observation,
--                                hypothesis, question, plan, result).
--   4. coordination_conflicts — detected contradictions over
--                                mutation_proposals (Wave 18S).
--
-- All four tables are tenant-scoped and use the canonical
-- `current_setting('app.tenant_id', true)` GUC RLS pattern from
-- migration 0003.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. active_agents — real-time registry
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS active_agents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text NOT NULL,
  agent_id                text NOT NULL,
  agent_kind              text NOT NULL,
  scope_id                text,
  subject                 jsonb,
  parent_agent_id         text,
  started_at              timestamptz NOT NULL DEFAULT now(),
  expected_completion_at  timestamptz,
  heartbeat_at            timestamptz NOT NULL DEFAULT now(),
  status                  text NOT NULL DEFAULT 'running',
  audit_hash              text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'active_agents_kind_chk'
  ) THEN
    ALTER TABLE active_agents
      ADD CONSTRAINT active_agents_kind_chk
      CHECK (agent_kind IN (
        'root_md', 'district_md', 'specialisation',
        'spawned_wave', 'background_worker'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'active_agents_status_chk'
  ) THEN
    ALTER TABLE active_agents
      ADD CONSTRAINT active_agents_status_chk
      CHECK (status IN ('running', 'paused', 'completed', 'crashed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_aa_subject
  ON active_agents (tenant_id, (subject->>'kind'), (subject->>'id'));

CREATE INDEX IF NOT EXISTS idx_aa_running
  ON active_agents (tenant_id, status, heartbeat_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_aa_parent
  ON active_agents (tenant_id, parent_agent_id)
  WHERE parent_agent_id IS NOT NULL;

ALTER TABLE active_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS active_agents_tenant_read ON active_agents;
CREATE POLICY active_agents_tenant_read ON active_agents
  USING (tenant_id = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 2. agent_messages — A2A push channel
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  from_agent_id   text NOT NULL,
  to_agent_id     text,
  to_subject      jsonb,
  message_kind    text NOT NULL,
  payload         jsonb NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  ack_at          timestamptz,
  audit_hash      text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_messages_kind_chk'
  ) THEN
    ALTER TABLE agent_messages
      ADD CONSTRAINT agent_messages_kind_chk
      CHECK (message_kind IN (
        'inform', 'request', 'coordinate', 'conflict', 'handoff'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_am_to
  ON agent_messages (tenant_id, to_agent_id, ack_at)
  WHERE ack_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_am_subject
  ON agent_messages (tenant_id, (to_subject->>'kind'), (to_subject->>'id'));

CREATE INDEX IF NOT EXISTS idx_am_from
  ON agent_messages (tenant_id, from_agent_id, sent_at DESC);

ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_messages_tenant_read ON agent_messages;
CREATE POLICY agent_messages_tenant_read ON agent_messages
  USING (tenant_id = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 3. blackboard_postings — shared pull workspace
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS blackboard_postings (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text NOT NULL,
  scope_id                text,
  posted_by_agent_id      text NOT NULL,
  subject                 jsonb NOT NULL,
  contribution_kind       text NOT NULL,
  payload                 jsonb NOT NULL,
  supersedes_posting_id   uuid,
  posted_at               timestamptz NOT NULL DEFAULT now(),
  audit_hash              text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'blackboard_postings_kind_chk'
  ) THEN
    ALTER TABLE blackboard_postings
      ADD CONSTRAINT blackboard_postings_kind_chk
      CHECK (contribution_kind IN (
        'observation', 'hypothesis', 'question', 'plan', 'result'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bp_subject
  ON blackboard_postings (
    tenant_id, scope_id, (subject->>'kind'), (subject->>'id'), posted_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_bp_supersedes
  ON blackboard_postings (tenant_id, supersedes_posting_id)
  WHERE supersedes_posting_id IS NOT NULL;

ALTER TABLE blackboard_postings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blackboard_postings_tenant_read ON blackboard_postings;
CREATE POLICY blackboard_postings_tenant_read ON blackboard_postings
  USING (tenant_id = current_setting('app.tenant_id', true));

-- -----------------------------------------------------------------------------
-- 4. coordination_conflicts — detected contradictions
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS coordination_conflicts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   text NOT NULL,
  subject                     jsonb NOT NULL,
  conflicting_proposal_ids    uuid[] NOT NULL,
  detected_at                 timestamptz NOT NULL DEFAULT now(),
  resolution_kind             text,
  reconciliation_payload      jsonb,
  resolved_at                 timestamptz,
  audit_hash                  text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coordination_conflicts_resolution_chk'
  ) THEN
    ALTER TABLE coordination_conflicts
      ADD CONSTRAINT coordination_conflicts_resolution_chk
      CHECK (
        resolution_kind IS NULL OR
        resolution_kind IN ('ai_reconciled', 'owner_picked', 'both_rejected')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cc_subject
  ON coordination_conflicts (
    tenant_id, (subject->>'kind'), (subject->>'id'), detected_at DESC
  );

CREATE INDEX IF NOT EXISTS idx_cc_unresolved
  ON coordination_conflicts (tenant_id, detected_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE coordination_conflicts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS coordination_conflicts_tenant_read ON coordination_conflicts;
CREATE POLICY coordination_conflicts_tenant_read ON coordination_conflicts
  USING (tenant_id = current_setting('app.tenant_id', true));

COMMIT;
