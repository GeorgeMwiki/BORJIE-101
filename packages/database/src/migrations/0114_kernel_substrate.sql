-- ─────────────────────────────────────────────────────────────────────
-- Migration 0114 — Brain kernel substrate.
--
-- Persistence layer for the central-intelligence kernel: sampled
-- chain-of-thought (cot reservoir), persona drift events, and per-
-- think() provenance records. Mirrors LITFIN's kernel persistence
-- pattern, scoped to Borjie multi-tenancy.
-- ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE kernel_stakes AS ENUM ('low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kernel_tier AS ENUM (
    'tenant', 'lease', 'unit', 'block',
    'property', 'portfolio', 'org', 'industry'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE kernel_scope_kind AS ENUM ('tenant', 'platform');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE persona_drift_violation AS ENUM (
    'taboo', 'first-person-loss', 'tone', 'fabrication'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE persona_drift_severity AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS kernel_cot_reservoir (
  thought_id   TEXT PRIMARY KEY,
  tenant_id    TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id    TEXT NOT NULL,
  stakes       kernel_stakes NOT NULL,
  thought_text TEXT NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kernel_cot_tenant_time
  ON kernel_cot_reservoir (tenant_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_kernel_cot_thread
  ON kernel_cot_reservoir (thread_id);

CREATE TABLE IF NOT EXISTS kernel_persona_drift_events (
  id             TEXT PRIMARY KEY,
  thought_id     TEXT NOT NULL,
  tenant_id      TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id     TEXT NOT NULL,
  violation_type persona_drift_violation NOT NULL,
  severity       persona_drift_severity NOT NULL,
  excerpt        TEXT NOT NULL,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kernel_drift_tenant_time
  ON kernel_persona_drift_events (tenant_id, detected_at);

CREATE INDEX IF NOT EXISTS idx_kernel_drift_persona_severity
  ON kernel_persona_drift_events (persona_id, severity);

CREATE TABLE IF NOT EXISTS kernel_provenance (
  thought_id          TEXT PRIMARY KEY,
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  thread_id           TEXT NOT NULL,
  scope_kind          kernel_scope_kind NOT NULL,
  tier                kernel_tier NOT NULL,
  stakes              kernel_stakes NOT NULL,
  input_hash          TEXT NOT NULL,
  output_hash         TEXT NOT NULL,
  sensor_id           TEXT NOT NULL,
  model_id            TEXT NOT NULL,
  cache_hit           TEXT NOT NULL,
  judge_score         DOUBLE PRECISION,
  cohort_fingerprints JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_call_summaries JSONB NOT NULL DEFAULT '[]'::jsonb,
  latency_ms          DOUBLE PRECISION NOT NULL,
  produced_at         TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kernel_prov_tenant_time
  ON kernel_provenance (tenant_id, produced_at);

CREATE INDEX IF NOT EXISTS idx_kernel_prov_thread
  ON kernel_provenance (thread_id);

CREATE INDEX IF NOT EXISTS idx_kernel_prov_sensor
  ON kernel_provenance (sensor_id);

COMMENT ON TABLE kernel_cot_reservoir IS
  'Sampled chain-of-thought captures from the brain kernel for audit replay. Sample rate scales with stakes; critical = 100%, high = 50%, medium = 5%, low = 1%.';

COMMENT ON TABLE kernel_persona_drift_events IS
  'Voice consistency violations detected by the kernel''s self-awareness module. Mirrors LITFIN''s persona_drift_events.';

COMMENT ON TABLE kernel_provenance IS
  'Per-think() decision provenance: scope, tier, stakes, sensor, model, gates, cohort fingerprints, latency. Companion to ai_audit_chain''s tamper-evident hash chain.';
