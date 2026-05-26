-- =============================================================================
-- Migration 0025 — Junior Architecture (Wave 18V)
--
-- Implements `docs/DESIGN/JUNIOR_ARCHITECTURE_SPEC.md`. Two tables back
-- the contract every domain junior implements:
--
--   1. junior_personas  — global registry of JuniorPersona values (id,
--                         name, title, mandate, default_language,
--                         target_audiences, scope jsonb, escalation
--                         policy jsonb, brand, version).
--   2. agent_turns      — tenant-scoped append-only ledger; one row per
--                         turn whether the MD or a junior took it,
--                         linked to the cognitive_turn from Wave 18T.
--
-- junior_personas is platform-level (tenant-agnostic) — every tenant
-- gets the same junior catalogue. agent_turns is tenant-scoped and
-- RLS-bound for owner visibility.
--
-- Idempotent (`IF NOT EXISTS`). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. junior_personas — platform-level registry
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS junior_personas (
  id                  text        PRIMARY KEY,
  display_name        text        NOT NULL,
  title               text        NOT NULL,
  mandate             text        NOT NULL,
  default_language    text        NOT NULL DEFAULT 'en',
  target_audiences    text[]      NOT NULL,
  scope               jsonb       NOT NULL,
  escalation_policy   jsonb       NOT NULL,
  brand               text        NOT NULL DEFAULT 'borjie',
  version             integer     NOT NULL DEFAULT 1,
  registered_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT junior_personas_language_chk
    CHECK (default_language IN ('sw', 'en', 'fr')),
  CONSTRAINT junior_personas_version_chk
    CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS junior_personas_brand_idx
  ON junior_personas(brand);
CREATE INDEX IF NOT EXISTS junior_personas_audiences_idx
  ON junior_personas USING GIN (target_audiences);

-- -----------------------------------------------------------------------------
-- 2. agent_turns — tenant-scoped per-turn ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agent_turns (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text        NOT NULL,
  user_id                 text        NOT NULL,
  session_id              uuid        NOT NULL,
  agent_id                text        NOT NULL,
  audience                text        NOT NULL,
  was_escalation_to_md    boolean     NOT NULL DEFAULT false,
  cognitive_turn_id       uuid        REFERENCES cognitive_turns(id),
  artifact_ref            jsonb,
  occurred_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_turns_audience_chk
    CHECK (audience IN ('owner', 'admin', 'manager', 'employee', 'customer', 'regulator', 'public'))
);

CREATE INDEX IF NOT EXISTS agent_turns_session_idx
  ON agent_turns(session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS agent_turns_md_visibility_idx
  ON agent_turns(tenant_id, agent_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS agent_turns_cognitive_turn_idx
  ON agent_turns(cognitive_turn_id);
CREATE INDEX IF NOT EXISTS agent_turns_escalation_idx
  ON agent_turns(tenant_id, was_escalation_to_md, occurred_at DESC)
  WHERE was_escalation_to_md = true;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

ALTER TABLE agent_turns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_turns_tenant_read ON agent_turns;
CREATE POLICY agent_turns_tenant_read ON agent_turns
  USING (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS agent_turns_tenant_write ON agent_turns;
CREATE POLICY agent_turns_tenant_write ON agent_turns
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- junior_personas is global (platform-level) — readable by all
-- authenticated JWTs, writable only by SUPER_ADMIN at the API layer.
-- No tenant predicate.

-- -----------------------------------------------------------------------------
-- Comments
-- -----------------------------------------------------------------------------

COMMENT ON TABLE junior_personas IS
  'Junior Architecture (Wave 18V) — registry of JuniorPersona values. Global; every tenant gets the same junior catalogue.';
COMMENT ON COLUMN junior_personas.scope IS
  'JuniorScope shape — { data_tables, tab_recipes_owned, doc_recipes_owned, media_recipes_owned, research_topics, authority_tier_max, requires_md_for_tier_2 }.';
COMMENT ON COLUMN junior_personas.escalation_policy IS
  'EscalationPolicy shape — { auto_escalate_above_authority_tier, auto_escalate_on_cross_domain, auto_escalate_on_low_confidence, hand_off_transcript_to_mr_mwikila }.';

COMMENT ON TABLE agent_turns IS
  'Junior Architecture (Wave 18V) — tenant-scoped per-turn ledger. One row whether the MD or a junior handled the turn. The MD subscribes to this for cross-junior oversight.';
COMMENT ON COLUMN agent_turns.agent_id IS
  '"mr-mwikila" for MD turns; junior persona id (e.g. "mining-shift-planner") for junior turns.';
COMMENT ON COLUMN agent_turns.was_escalation_to_md IS
  'True when a junior handed off to the MD mid-turn — used for oversight + junior-quality metrics.';

COMMIT;
