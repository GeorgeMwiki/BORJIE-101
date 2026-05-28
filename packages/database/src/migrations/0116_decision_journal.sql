-- =============================================================================
-- Migration 0116 - Decision Journal (Wave DECISION-LEGIBILITY)
--
-- Companion to:
--   - services/api-gateway/src/services/decision-journal/recorder.ts
--   - services/api-gateway/src/workers/decision-retrospective-worker.ts
--   - services/api-gateway/src/composition/brain-tools/decision-journal-tools.ts
--   - Docs/DESIGN/DECISION_JOURNAL.md
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- Every decision — owner-made, brain-suggested-and-applied, four-eye
-- approved, or automated-policy — is captured with full rationale,
-- alternatives considered, and (later) outcome graded by the
-- retrospective worker. Owners can ask "what did I decide about Geita
-- compliance last quarter?" and get the recorded answer back. The
-- brain learns from the success-rate over time.
--
-- Surface:
--   decisions          - one row per recorded decision.
--   decision_outcomes  - retrospective grading once the horizon elapses.
--   decision_links     - graph linking supersedes / depends_on /
--                        informed_by / reversed_by relationships.
--
-- Tenant-scoped via the canonical `app.tenant_id` GUC RLS predicate.
-- RLS is FORCE-enabled per the Borjie hard rule (CLAUDE.md).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" - never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── decisions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decisions (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   text        NOT NULL,
  /** Who made the call. */
  decided_by_kind             text        NOT NULL,
  /** Actor id (owner user id / agent id / brain persona slug / policy id). */
  decided_by_actor_id         text        NOT NULL,
  /** Short subject phrase, e.g. "file April royalty: now or Friday". */
  decision_subject            text        NOT NULL,
  /** Optional concrete entity the decision pertained to. */
  decision_subject_entity_kind text,
  decision_subject_entity_id   text,
  /** The chosen value as JSON, e.g. {"choice":"file_now","date":"2026-04-09"}. */
  decided_value               jsonb       NOT NULL,
  /** Alternatives weighed at decision time:
   *  [{option:{...}, why_not:"..."}, ...]. */
  alternatives_considered     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  /** Free-form rationale text. The brain prompt template enforces a
   *  populated value for non-trivial decisions. */
  rationale                   text        NOT NULL,
  /** Confidence the chooser had at decision time (0..1). */
  confidence                  numeric(4,3),
  decided_at                  timestamptz NOT NULL DEFAULT now(),
  /** Scope ids the decision touched (sites / pits / counterparties). */
  scope_ids                   text[]      NOT NULL DEFAULT ARRAY[]::text[],
  /** Optional prediction id the decision was anchored to (so the
   *  retrospective worker can grade against the observed outcome). */
  related_prediction_id       text,
  /** Optional hash from the immutable audit chain (ai_audit_chain.entry_hash)
   *  the WRITE that enacted this decision produced. */
  related_action_audit_hash   text,
  /** Lifecycle status; rolled_back / superseded set by recorder updates. */
  status                      text        NOT NULL DEFAULT 'committed',
  /** Universal provenance envelope (chat session, turn, persona slug). */
  provenance                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** Hash chained from the previous decision row for this tenant.
   *  Computed by the recorder service via the canonical-json hash
   *  utility from @borjie/audit-hash-chain. */
  entry_hash                  text        NOT NULL,
  prev_hash                   text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decisions_decided_by_kind_chk'
  ) THEN
    ALTER TABLE decisions
      ADD CONSTRAINT decisions_decided_by_kind_chk
      CHECK (decided_by_kind IN (
        'owner', 'brain', 'agent_apply', 'four_eye', 'automated_policy'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decisions_status_chk'
  ) THEN
    ALTER TABLE decisions
      ADD CONSTRAINT decisions_status_chk
      CHECK (status IN ('committed', 'rolled_back', 'superseded'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decisions_confidence_chk'
  ) THEN
    ALTER TABLE decisions
      ADD CONSTRAINT decisions_confidence_chk
      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
  END IF;
END $$;

-- Hot path: "what did I decide recently?" — tenant + decided_at desc.
CREATE INDEX IF NOT EXISTS decisions_tenant_recent_idx
  ON decisions (tenant_id, decided_at DESC);

-- Hot path: filter by decided_by_kind (e.g. owner-made only).
CREATE INDEX IF NOT EXISTS decisions_tenant_kind_idx
  ON decisions (tenant_id, decided_by_kind, decided_at DESC);

-- Hot path: grade-by-prediction join.
CREATE INDEX IF NOT EXISTS decisions_prediction_idx
  ON decisions (tenant_id, related_prediction_id)
  WHERE related_prediction_id IS NOT NULL;

-- Hot path: subject search (used by what_did_i_decide).
CREATE INDEX IF NOT EXISTS decisions_subject_gin_idx
  ON decisions USING gin (to_tsvector('english', decision_subject || ' ' || rationale));

-- Hash chain verifier hot path.
CREATE INDEX IF NOT EXISTS decisions_tenant_chain_idx
  ON decisions (tenant_id, decided_at);

ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'decisions'
       AND policyname = 'decisions_tenant_isolation'
  ) THEN
    CREATE POLICY decisions_tenant_isolation
      ON decisions
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- ─── decision_outcomes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_outcomes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  decision_id         uuid        NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  /** Plain-language outcome summary, e.g. "filing arrived 09 Apr,
   *  Commission accepted same day, no penalty incurred". */
  outcome_summary     text        NOT NULL,
  /** Observed value in TZS (positive = saving / revenue, negative = cost). */
  observed_value_tzs  numeric(18,2),
  observed_at         timestamptz NOT NULL DEFAULT now(),
  /** Grade — good / neutral / bad / undetermined. */
  retrospective_grade text        NOT NULL,
  /** Brain-generated learnings ("filing 3d early saved 5% penalty; do
   *  again next month if cash flow permits"). */
  learnings           text,
  /** Who recorded the grade. */
  recorded_by         text        NOT NULL,
  entry_hash          text        NOT NULL,
  prev_hash           text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decision_outcomes_grade_chk'
  ) THEN
    ALTER TABLE decision_outcomes
      ADD CONSTRAINT decision_outcomes_grade_chk
      CHECK (retrospective_grade IN ('good', 'neutral', 'bad', 'undetermined'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decision_outcomes_recorded_by_chk'
  ) THEN
    ALTER TABLE decision_outcomes
      ADD CONSTRAINT decision_outcomes_recorded_by_chk
      CHECK (recorded_by IN ('reconciler', 'owner', 'brain'));
  END IF;
END $$;

-- Hot path: outcome-by-decision lookup.
CREATE INDEX IF NOT EXISTS decision_outcomes_decision_idx
  ON decision_outcomes (tenant_id, decision_id, observed_at DESC);

-- Hot path: success-rate aggregator.
CREATE INDEX IF NOT EXISTS decision_outcomes_grade_idx
  ON decision_outcomes (tenant_id, retrospective_grade, observed_at DESC);

ALTER TABLE decision_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_outcomes FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'decision_outcomes'
       AND policyname = 'decision_outcomes_tenant_isolation'
  ) THEN
    CREATE POLICY decision_outcomes_tenant_isolation
      ON decision_outcomes
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- ─── decision_links ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_links (
  tenant_id           text        NOT NULL,
  source_decision_id  uuid        NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  target_decision_id  uuid        NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  /** Relationship semantics. */
  relationship        text        NOT NULL,
  /** Optional note explaining why the link exists. */
  note                text,
  entry_hash          text        NOT NULL,
  prev_hash           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_decision_id, target_decision_id, relationship)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decision_links_relationship_chk'
  ) THEN
    ALTER TABLE decision_links
      ADD CONSTRAINT decision_links_relationship_chk
      CHECK (relationship IN (
        'supersedes', 'depends_on', 'informed_by', 'reversed_by'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'decision_links_no_self_loop_chk'
  ) THEN
    ALTER TABLE decision_links
      ADD CONSTRAINT decision_links_no_self_loop_chk
      CHECK (source_decision_id <> target_decision_id);
  END IF;
END $$;

-- Hot path: from-source traversal.
CREATE INDEX IF NOT EXISTS decision_links_source_idx
  ON decision_links (tenant_id, source_decision_id);

-- Hot path: incoming-edge traversal (replay).
CREATE INDEX IF NOT EXISTS decision_links_target_idx
  ON decision_links (tenant_id, target_decision_id);

ALTER TABLE decision_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_links FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'decision_links'
       AND policyname = 'decision_links_tenant_isolation'
  ) THEN
    CREATE POLICY decision_links_tenant_isolation
      ON decision_links
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
