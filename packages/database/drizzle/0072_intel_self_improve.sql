-- =============================================================================
-- Migration 0072 — Intel Self-Improve Wiring (INTEL-SELF-IMPROVE wave)
--
-- Companion to Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md and the
-- intel-self-improve package (@borjie/intel-self-improve).
--
-- Persona: Mr. Mwikila. Every forecast, statistical test, graph query,
-- causal estimate, anomaly score and recommendation he emits is captured
-- here so the existing capability-catalogue measurement worker can score
-- competence / calibration / utility on the same 7d / 28d / 91d windows
-- that already govern research_v1 and compose_anything_v1 (see
-- Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md).
--
-- Two tables:
--
--   intel_invocation_audit — one row per intel call. Carries the inputs,
--                            outputs, claimed confidence, latency and
--                            cost. The outcome-observer cron fills the
--                            observed-value columns later. Hash-chained
--                            per (tenant_id, intel_kind).
--
--   intel_skill_traces     — per-(tenant, intel_kind, pattern_signature)
--                            success/failure counter. Implements the
--                            Voyager-style skill library reuse pattern
--                            (Wang et al. arXiv 2305.16291).
--                            UNIQUE on (tenant_id, intel_kind,
--                            pattern_signature).
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration 0003.
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- intel_invocation_audit — every measured intel call
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intel_invocation_audit (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL,
  /** FK alignment with `capabilities.id` from the catalogue. */
  capability_id         uuid NOT NULL,
  /** One of: forecast | stat | graph_db | causal | anomaly | recommendation. */
  intel_kind            text NOT NULL,
  /** Canonical JSON projection of the call inputs (post-redaction). */
  input_payload         jsonb NOT NULL,
  /** Canonical JSON projection of the call outputs. */
  output_payload        jsonb NOT NULL,
  /** Confidence the underlying model claims in its output. [0,1]. */
  claimed_confidence    double precision NOT NULL DEFAULT 0,
  /** Wall-clock latency from invocation to result. */
  latency_ms            integer NOT NULL DEFAULT 0,
  /** Cost in US cents. */
  cost_usd_cents        integer NOT NULL DEFAULT 0,
  /** Filled by the outcome-observer cron — null until horizon reached. */
  observed_outcome      text,
  /** Filled by the outcome-observer cron — null until horizon reached. */
  user_followthrough    text,
  /** Free-form ground-truth attachment, e.g. observed forecast value. */
  observation_payload   jsonb,
  invoked_at            timestamptz NOT NULL DEFAULT now(),
  observed_at           timestamptz,
  /** Hash of the prior row in this tenant's intel_kind chain. */
  prev_hash             text NOT NULL DEFAULT '',
  audit_hash            text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_invocation_audit_kind_chk'
  ) THEN
    ALTER TABLE intel_invocation_audit
      ADD CONSTRAINT intel_invocation_audit_kind_chk
      CHECK (intel_kind IN (
        'forecast','stat','graph_db','causal','anomaly','recommendation'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_invocation_audit_confidence_chk'
  ) THEN
    ALTER TABLE intel_invocation_audit
      ADD CONSTRAINT intel_invocation_audit_confidence_chk
      CHECK (claimed_confidence >= 0 AND claimed_confidence <= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_invocation_audit_latency_chk'
  ) THEN
    ALTER TABLE intel_invocation_audit
      ADD CONSTRAINT intel_invocation_audit_latency_chk
      CHECK (latency_ms >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_invocation_audit_cost_chk'
  ) THEN
    ALTER TABLE intel_invocation_audit
      ADD CONSTRAINT intel_invocation_audit_cost_chk
      CHECK (cost_usd_cents >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_invocation_audit_outcome_chk'
  ) THEN
    ALTER TABLE intel_invocation_audit
      ADD CONSTRAINT intel_invocation_audit_outcome_chk
      CHECK (
        observed_outcome IS NULL
        OR observed_outcome IN ('confirmed','disconfirmed','partial','unknown')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_invocation_audit_followthrough_chk'
  ) THEN
    ALTER TABLE intel_invocation_audit
      ADD CONSTRAINT intel_invocation_audit_followthrough_chk
      CHECK (
        user_followthrough IS NULL
        OR user_followthrough IN ('accepted','modified','rejected','ignored')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_invocation_audit_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE intel_invocation_audit
      ADD CONSTRAINT intel_invocation_audit_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_intel_invocation_audit_tenant_kind_invoked
  ON intel_invocation_audit (tenant_id, intel_kind, invoked_at DESC);

CREATE INDEX IF NOT EXISTS idx_intel_invocation_audit_capability
  ON intel_invocation_audit (tenant_id, capability_id, invoked_at DESC);

CREATE INDEX IF NOT EXISTS idx_intel_invocation_audit_pending_observation
  ON intel_invocation_audit (tenant_id, intel_kind, invoked_at)
  WHERE observed_outcome IS NULL;

CREATE INDEX IF NOT EXISTS idx_intel_invocation_audit_audit_hash
  ON intel_invocation_audit (audit_hash);

ALTER TABLE intel_invocation_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'intel_invocation_audit'
       AND policyname = 'intel_invocation_audit_tenant_isolation'
  ) THEN
    CREATE POLICY intel_invocation_audit_tenant_isolation
      ON intel_invocation_audit
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- intel_skill_traces — Voyager-style skill counters per pattern
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS intel_skill_traces (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             text NOT NULL,
  intel_kind            text NOT NULL,
  /** sha256 over canonical-json of the call inputs. */
  pattern_signature     text NOT NULL,
  /** Count of successful invocations under this pattern. */
  success_count         integer NOT NULL DEFAULT 0,
  /** Count of failed invocations under this pattern. */
  failure_count         integer NOT NULL DEFAULT 0,
  /** Last-seen capability id that handled this pattern. */
  last_capability_id    uuid,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  prev_hash             text NOT NULL DEFAULT '',
  audit_hash            text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_skill_traces_kind_chk'
  ) THEN
    ALTER TABLE intel_skill_traces
      ADD CONSTRAINT intel_skill_traces_kind_chk
      CHECK (intel_kind IN (
        'forecast','stat','graph_db','causal','anomaly','recommendation'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_skill_traces_counters_nonneg_chk'
  ) THEN
    ALTER TABLE intel_skill_traces
      ADD CONSTRAINT intel_skill_traces_counters_nonneg_chk
      CHECK (success_count >= 0 AND failure_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_skill_traces_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE intel_skill_traces
      ADD CONSTRAINT intel_skill_traces_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'intel_skill_traces_pattern_unique'
  ) THEN
    ALTER TABLE intel_skill_traces
      ADD CONSTRAINT intel_skill_traces_pattern_unique
      UNIQUE (tenant_id, intel_kind, pattern_signature);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_intel_skill_traces_tenant_kind_last
  ON intel_skill_traces (tenant_id, intel_kind, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_intel_skill_traces_audit_hash
  ON intel_skill_traces (audit_hash);

ALTER TABLE intel_skill_traces ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'intel_skill_traces'
       AND policyname = 'intel_skill_traces_tenant_isolation'
  ) THEN
    CREATE POLICY intel_skill_traces_tenant_isolation
      ON intel_skill_traces
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
