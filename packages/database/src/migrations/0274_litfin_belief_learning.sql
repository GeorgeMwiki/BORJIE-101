-- =============================================================================
-- Migration 0274 — Epistemic belief layer + learning-signal persistence (LP-17/18)
--
-- LITFIN port wave (Docs/LITFIN_DEEP_EVALUATION_AND_GAP_CLOSURE_2026-06-03.md).
-- Backs the new `@borjie/belief-engine` + `@borjie/learning-signal-emitter`
-- packages. Mirrors LITFIN's brain_beliefs / belief_revisions / preference_pairs
-- tables, re-skinned to the Borjie mining-estate domain (org→tenant,
-- borrower→owner/worker; NO lending/PD/credit columns).
--
--   brain_beliefs
--     One row per (subject, subject_user_id, subject_org_id) triple. Holds the
--     brain's current epistemic state about a mining-domain fact (royalty rate,
--     ore-grade economics, regional logistics, regulatory cap, …). value_jsonb
--     carries the typed BeliefValue; sources_jsonb the evidence chain.
--     NEVER written directly by app code — only the convince-loop revises a
--     belief, and only when the confidence delta clears the 0.25 gate.
--
--   belief_revisions
--     Immutable, append-only revision history. One row per convince-loop
--     decision (revise / split / strengthen / no-change). before_jsonb +
--     after_jsonb snapshot the belief on each side of the gate, with the
--     confidence_delta and a human rationale sentence.
--
--   belief_review_queue
--     The "split" band (0.05 < delta <= 0.25): contradictions that did NOT
--     clear the revise gate but are too strong to discard. Queued here for a
--     human / sleep-pass to adjudicate. status: pending | accepted | rejected.
--
--   learning_signals
--     One row per (action, outcome) pair the signal-emitter scores + fans out.
--     signal_hash is the idempotency key — a re-emit of the same triple collides
--     on the UNIQUE constraint and is absorbed at insert time.
--
--   preference_pairs
--     DPO (winner, loser) feature deltas. The nightly trainer drains these into
--     a logistic head. winner_features / loser_features are jsonb numeric arrays.
--
--   preference_head_weights
--     The trained DPO head (one active row). Mirrors the LinUCB-bandit + DPO
--     persistence pattern. `active` boolean selects the live head.
--
--   correlation_findings
--     Nightly Pearson belief×outcome pass output (|r|>0.4, p<0.05, n>30).
--
-- ── SECURITY MODEL ────────────────────────────────────────────────────────────
-- Every table is tenant-scoped via a NULLABLE tenant_id and the canonical
-- tenant-nullable RLS idiom (migration 0184 / 0118): platform-wide rows
-- (tenant_id IS NULL) are the shared ground-truth visible under EVERY tenant
-- context; tenant-scoped rows are visible ONLY under the matching
-- `app.current_tenant_id` GUC. Never a bare `tenant_id = GUC` predicate — that
-- would hide the shared corpus-derived beliefs and blank the brain.
--
-- RLS is ENABLE + FORCE on all seven tables. anon + authenticated are revoked
-- entirely: these tables are SERVICE-MANAGED (the api-gateway privileged
-- connection writes them post-isolation-gate) and must NEVER be served over the
-- Supabase PostgREST API. Guarded by pg_roles existence so the migration also
-- applies on a vanilla PG (CI dry-run).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit this file
-- after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

-- ─── Table 1: brain_beliefs ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS brain_beliefs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL ⇒ platform-wide / domain-scoped fact (shared ground truth).
  tenant_id          text        REFERENCES tenants(id) ON DELETE CASCADE,
  domain             text        NOT NULL,
  -- Canonical lowercase-dashed key, e.g. 'mwanza-gold-ore-grade'.
  subject            text        NOT NULL,
  description        text        NOT NULL,
  -- Typed BeliefValue (scalar | range | categorical | boolean | text).
  value_jsonb        jsonb       NOT NULL,
  confidence         double precision NOT NULL DEFAULT 0.1,
  -- Evidence chain — array of BeliefSource objects.
  sources_jsonb      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  revised_at         timestamptz NOT NULL DEFAULT now(),
  revision_count     integer     NOT NULL DEFAULT 0,
  tags               jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- iter-52-isolation C1: nullable tenant scope hints (owner / worker user id;
  -- org-process id). Both NULL ⇒ platform-wide. Distinguishes belief rows that
  -- share a subject string but live in different scopes.
  subject_user_id    text,
  subject_org_id     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- The natural key is the (subject, user, org) triple — a worker's private
-- belief never collides with another worker's identically-named row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_brain_beliefs_subject_scope
  ON brain_beliefs (
    subject,
    COALESCE(subject_user_id, ''),
    COALESCE(subject_org_id, '')
  );

CREATE INDEX IF NOT EXISTS idx_brain_beliefs_tenant   ON brain_beliefs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_brain_beliefs_domain   ON brain_beliefs (domain);
CREATE INDEX IF NOT EXISTS idx_brain_beliefs_revised  ON brain_beliefs (revised_at DESC);

ALTER TABLE brain_beliefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_beliefs FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'brain_beliefs'
       AND policyname = 'brain_beliefs_tenant_isolation'
  ) THEN
    CREATE POLICY brain_beliefs_tenant_isolation
      ON brain_beliefs
      FOR ALL
      USING (tenant_id IS NULL
             OR tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id IS NULL
                  OR tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ─── Table 2: belief_revisions (append-only) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS belief_revisions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        REFERENCES tenants(id) ON DELETE CASCADE,
  belief_id          uuid        NOT NULL,
  before_jsonb       jsonb       NOT NULL,
  after_jsonb        jsonb       NOT NULL,
  rationale          text        NOT NULL,
  new_sources_jsonb  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  confidence_delta   double precision NOT NULL DEFAULT 0,
  -- chat-hook | admin-force | cron-pass | self-revision | signal-emitter
  triggered_by       text        NOT NULL DEFAULT 'signal-emitter',
  subject_user_id    text,
  subject_org_id     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_belief_revisions_belief ON belief_revisions (belief_id);
CREATE INDEX IF NOT EXISTS idx_belief_revisions_tenant ON belief_revisions (tenant_id);

ALTER TABLE belief_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief_revisions FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'belief_revisions'
       AND policyname = 'belief_revisions_tenant_isolation'
  ) THEN
    CREATE POLICY belief_revisions_tenant_isolation
      ON belief_revisions
      FOR ALL
      USING (tenant_id IS NULL
             OR tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id IS NULL
                  OR tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ─── Table 3: belief_review_queue (the 0.05–0.25 split band) ──────────────────

CREATE TABLE IF NOT EXISTS belief_review_queue (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        REFERENCES tenants(id) ON DELETE CASCADE,
  belief_id          uuid        NOT NULL,
  subject            text        NOT NULL,
  -- The contradicting claim that did not clear the revise gate.
  proposed_value_jsonb jsonb     NOT NULL,
  confidence_delta   double precision NOT NULL,
  rationale          text        NOT NULL,
  -- pending | accepted | rejected
  status             text        NOT NULL DEFAULT 'pending',
  resolved_at        timestamptz,
  resolved_by        text,
  subject_user_id    text,
  subject_org_id     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_belief_review_queue_status
  ON belief_review_queue (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_belief_review_queue_tenant
  ON belief_review_queue (tenant_id);

ALTER TABLE belief_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE belief_review_queue FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'belief_review_queue'
       AND policyname = 'belief_review_queue_tenant_isolation'
  ) THEN
    CREATE POLICY belief_review_queue_tenant_isolation
      ON belief_review_queue
      FOR ALL
      USING (tenant_id IS NULL
             OR tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id IS NULL
                  OR tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ─── Table 4: learning_signals ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS learning_signals (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        REFERENCES tenants(id) ON DELETE CASCADE,
  -- sha256(actionRef|outcomeRef|reward) — idempotency key.
  signal_hash        text        NOT NULL,
  action_ref         text        NOT NULL,
  action_kind        text        NOT NULL,
  outcome_ref        text,
  reward             double precision NOT NULL,
  components_jsonb   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- user | org | platform
  tenant_scope       text        NOT NULL,
  routed_to_jsonb    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  emitted_by         text        NOT NULL,
  decision_trace_id  text,
  subject_user_id    text,
  subject_org_id     text,
  captured_at        timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: a re-emit of the same (action, outcome, reward) triple is absorbed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_signals_hash
  ON learning_signals (signal_hash);
CREATE INDEX IF NOT EXISTS idx_learning_signals_tenant ON learning_signals (tenant_id);
CREATE INDEX IF NOT EXISTS idx_learning_signals_action ON learning_signals (action_ref);

ALTER TABLE learning_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_signals FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'learning_signals'
       AND policyname = 'learning_signals_tenant_isolation'
  ) THEN
    CREATE POLICY learning_signals_tenant_isolation
      ON learning_signals
      FOR ALL
      USING (tenant_id IS NULL
             OR tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id IS NULL
                  OR tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ─── Table 5: preference_pairs (DPO winner/loser feature deltas) ──────────────

CREATE TABLE IF NOT EXISTS preference_pairs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        REFERENCES tenants(id) ON DELETE CASCADE,
  -- Stable (intent, persona, language) hash for the decision context.
  context_hash       text        NOT NULL,
  winner_features    jsonb       NOT NULL,
  loser_features     jsonb       NOT NULL,
  winner_reward      double precision NOT NULL,
  loser_reward       double precision NOT NULL,
  -- user | org | platform
  tenant_scope       text        NOT NULL,
  subject_user_id    text,
  subject_org_id     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preference_pairs_tenant  ON preference_pairs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_preference_pairs_context ON preference_pairs (context_hash);
CREATE INDEX IF NOT EXISTS idx_preference_pairs_created ON preference_pairs (created_at DESC);

ALTER TABLE preference_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE preference_pairs FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'preference_pairs'
       AND policyname = 'preference_pairs_tenant_isolation'
  ) THEN
    CREATE POLICY preference_pairs_tenant_isolation
      ON preference_pairs
      FOR ALL
      USING (tenant_id IS NULL
             OR tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id IS NULL
                  OR tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ─── Table 6: preference_head_weights (trained DPO head — one active row) ─────

CREATE TABLE IF NOT EXISTS preference_head_weights (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        REFERENCES tenants(id) ON DELETE CASCADE,
  version            text        NOT NULL,
  weights            jsonb       NOT NULL,
  d                  integer     NOT NULL,
  beta               double precision NOT NULL DEFAULT 0.1,
  seen_pairs         integer     NOT NULL DEFAULT 0,
  n_training_pairs   integer     NOT NULL DEFAULT 0,
  active             boolean     NOT NULL DEFAULT false,
  trained_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- At most one active head per tenant scope (NULL ⇒ platform-wide head).
CREATE UNIQUE INDEX IF NOT EXISTS uq_preference_head_active
  ON preference_head_weights (COALESCE(tenant_id, ''))
  WHERE active = true;

ALTER TABLE preference_head_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE preference_head_weights FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'preference_head_weights'
       AND policyname = 'preference_head_weights_tenant_isolation'
  ) THEN
    CREATE POLICY preference_head_weights_tenant_isolation
      ON preference_head_weights
      FOR ALL
      USING (tenant_id IS NULL
             OR tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id IS NULL
                  OR tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ─── Table 7: correlation_findings (nightly belief×outcome Pearson pass) ──────

CREATE TABLE IF NOT EXISTS correlation_findings (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text        REFERENCES tenants(id) ON DELETE CASCADE,
  sector             text,
  region             text,
  belief_subject     text        NOT NULL,
  outcome_metric     text        NOT NULL,
  pearson_r          double precision NOT NULL,
  p_value            double precision NOT NULL,
  sample_size        integer     NOT NULL,
  summary            text        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_correlation_findings_tenant
  ON correlation_findings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_correlation_findings_subject
  ON correlation_findings (belief_subject);

ALTER TABLE correlation_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE correlation_findings FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'correlation_findings'
       AND policyname = 'correlation_findings_tenant_isolation'
  ) THEN
    CREATE POLICY correlation_findings_tenant_isolation
      ON correlation_findings
      FOR ALL
      USING (tenant_id IS NULL
             OR tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id IS NULL
                  OR tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- ─── Lock down: SERVICE-MANAGED ONLY (never exposed via the Supabase REST API).
-- These tables hold the brain's epistemic state + learning telemetry. They are
-- written by the api-gateway privileged connection AFTER the per-tier isolation
-- gate; the public PostgREST roles must never read or write them. Revoke all
-- access from anon + authenticated so a tenant-scoped RLS predicate is never the
-- last line of defence. Guarded by role existence so the migration also applies
-- on a vanilla PG (CI dry-run on empty postgres:17).
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'brain_beliefs',
    'belief_revisions',
    'belief_review_queue',
    'learning_signals',
    'preference_pairs',
    'preference_head_weights',
    'correlation_findings'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    FOREACH tbl IN ARRAY tables LOOP
      EXECUTE format('REVOKE ALL ON %I FROM anon;', tbl);
    END LOOP;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    FOREACH tbl IN ARRAY tables LOOP
      EXECUTE format('REVOKE ALL ON %I FROM authenticated;', tbl);
    END LOOP;
  END IF;
END $$;

COMMIT;
