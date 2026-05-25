-- ─────────────────────────────────────────────────────────────────────
-- Migration 0203 — Conversation artifacts (Piece F).
--
-- Versioned artifacts (docs, charts, tables, forms, KPI cards,
-- deck slides, images, code) produced inside a thread. Each artifact
-- can be branched — `branchArtifact(id)` writes a new row with
-- `parent_version_id` pointing at the source.
--
-- Versions are immutable. Updating an artifact means INSERTING a new
-- row with bumped `version` and same `id` (the UNIQUE on (thread_id,
-- id, version) lets the same logical artifact carry multiple versions
-- inside the same thread).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_artifacts (
  id                          TEXT NOT NULL,
  thread_id                   TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id),
  artifact_type               TEXT NOT NULL
    CHECK (artifact_type IN (
      'doc', 'chart', 'table', 'form', 'kpi',
      'deck_slide', 'image', 'code'
    )),
  version                     SMALLINT NOT NULL DEFAULT 1,
  parent_version_id           TEXT,
  content_jsonb               JSONB NOT NULL,
  title                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (thread_id, id, version)
);

CREATE INDEX IF NOT EXISTS idx_conversation_artifacts_tenant
  ON conversation_artifacts (tenant_id);

CREATE INDEX IF NOT EXISTS idx_conversation_artifacts_thread
  ON conversation_artifacts (thread_id);

CREATE INDEX IF NOT EXISTS idx_conversation_artifacts_id
  ON conversation_artifacts (id);

CREATE INDEX IF NOT EXISTS idx_conversation_artifacts_type
  ON conversation_artifacts (artifact_type);

COMMENT ON TABLE conversation_artifacts IS
  'Piece F — versioned thread artifacts (docs, charts, tables, ...). Versions are immutable; new versions are new rows.';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS conversation_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS conversation_artifacts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'conversation_artifacts') THEN
    DROP POLICY IF EXISTS conversation_artifacts_tenant_isolation ON conversation_artifacts;
    CREATE POLICY conversation_artifacts_tenant_isolation ON conversation_artifacts
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS conversation_artifacts_tenant_isolation_write ON conversation_artifacts;
    CREATE POLICY conversation_artifacts_tenant_isolation_write ON conversation_artifacts
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
