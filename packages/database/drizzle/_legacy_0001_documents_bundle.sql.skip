-- Documents bundle migration (NEW 5, 10, 14, 15)
-- Creates: document_render_jobs, letter_requests, scan_bundles,
-- scan_bundle_pages, document_embeddings (pgvector),
-- doc_chat_sessions, doc_chat_messages.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE renderer_kind AS ENUM ('text', 'docxtemplater', 'react-pdf', 'typst');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE render_job_status AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE letter_type AS ENUM (
    'residency_proof', 'tenancy_confirmation', 'payment_confirmation', 'tenant_reference'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE letter_request_status AS ENUM (
    'requested', 'drafted', 'pending_approval', 'approved', 'issued', 'rejected', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE scan_bundle_status AS ENUM ('draft', 'processing', 'ready', 'submitted', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doc_chat_scope AS ENUM ('single_document', 'multi_document', 'group_chat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE doc_chat_role AS ENUM ('user', 'assistant', 'system');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_render_jobs (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  template_id           TEXT NOT NULL,
  template_version      TEXT NOT NULL,
  renderer_kind         renderer_kind NOT NULL,
  status                render_job_status NOT NULL DEFAULT 'queued',
  input_payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_document_id    TEXT,
  output_mime_type      TEXT,
  output_size_bytes     INTEGER,
  page_count            INTEGER,
  error_code            TEXT,
  error_message         TEXT,
  related_entity_type   TEXT,
  related_entity_id     TEXT,
  requested_by          TEXT,
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS document_render_jobs_tenant_idx   ON document_render_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS document_render_jobs_status_idx   ON document_render_jobs(status);
CREATE INDEX IF NOT EXISTS document_render_jobs_template_idx ON document_render_jobs(template_id);
CREATE INDEX IF NOT EXISTS document_render_jobs_related_idx  ON document_render_jobs(related_entity_type, related_entity_id);

CREATE TABLE IF NOT EXISTS letter_requests (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id          TEXT REFERENCES customers(id) ON DELETE SET NULL,
  letter_type          letter_type NOT NULL,
  status               letter_request_status NOT NULL DEFAULT 'requested',
  request_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_content        TEXT,
  render_job_id        TEXT,
  approval_id          TEXT,
  approved_by          TEXT,
  approved_at          TIMESTAMPTZ,
  rejection_reason     TEXT,
  issued_document_id   TEXT,
  issued_at            TIMESTAMPTZ,
  requested_by         TEXT NOT NULL,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS letter_requests_tenant_idx   ON letter_requests(tenant_id);
CREATE INDEX IF NOT EXISTS letter_requests_customer_idx ON letter_requests(customer_id);
CREATE INDEX IF NOT EXISTS letter_requests_status_idx   ON letter_requests(status);
CREATE INDEX IF NOT EXISTS letter_requests_type_idx     ON letter_requests(letter_type);

CREATE TABLE IF NOT EXISTS scan_bundles (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title                  TEXT,
  purpose                TEXT,
  status                 scan_bundle_status NOT NULL DEFAULT 'draft',
  assembled_document_id  TEXT,
  page_count             INTEGER NOT NULL DEFAULT 0,
  processing_log         JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message          TEXT,
  created_by             TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS scan_bundles_tenant_idx     ON scan_bundles(tenant_id);
CREATE INDEX IF NOT EXISTS scan_bundles_status_idx     ON scan_bundles(status);
CREATE INDEX IF NOT EXISTS scan_bundles_created_by_idx ON scan_bundles(created_by);

CREATE TABLE IF NOT EXISTS scan_bundle_pages (
  id              TEXT PRIMARY KEY,
  bundle_id       TEXT NOT NULL REFERENCES scan_bundles(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  page_number     INTEGER NOT NULL,
  storage_key     TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  width_px        INTEGER,
  height_px       INTEGER,
  quad            JSONB,
  ocr_text        TEXT,
  ocr_confidence  INTEGER,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scan_bundle_pages_bundle_idx ON scan_bundle_pages(bundle_id);
CREATE INDEX IF NOT EXISTS scan_bundle_pages_tenant_idx ON scan_bundle_pages(tenant_id);

CREATE TABLE IF NOT EXISTS document_embeddings (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id       TEXT NOT NULL,
  chunk_index       INTEGER NOT NULL,
  chunk_text        TEXT NOT NULL,
  chunk_meta        JSONB DEFAULT '{}'::jsonb,
  embedding         vector(1536) NOT NULL,
  embedding_model   TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_embeddings_tenant_idx   ON document_embeddings(tenant_id);
CREATE INDEX IF NOT EXISTS document_embeddings_document_idx ON document_embeddings(document_id);
-- Approximate nearest neighbor index (HNSW if available, else ivfflat)
-- CREATE INDEX IF NOT EXISTS document_embeddings_hnsw ON document_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS doc_chat_sessions (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope              doc_chat_scope NOT NULL DEFAULT 'single_document',
  title              TEXT,
  document_ids       JSONB NOT NULL DEFAULT '[]'::jsonb,
  participants       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by         TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS doc_chat_sessions_tenant_idx     ON doc_chat_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS doc_chat_sessions_created_by_idx ON doc_chat_sessions(created_by);

CREATE TABLE IF NOT EXISTS doc_chat_messages (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id           TEXT NOT NULL REFERENCES doc_chat_sessions(id) ON DELETE CASCADE,
  role                 doc_chat_role NOT NULL,
  author_user_id       TEXT,
  content              TEXT NOT NULL,
  citations            JSONB NOT NULL DEFAULT '[]'::jsonb,
  retrieved_chunk_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  model                TEXT,
  tokens_used          JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS doc_chat_messages_tenant_idx  ON doc_chat_messages(tenant_id);
CREATE INDEX IF NOT EXISTS doc_chat_messages_session_idx ON doc_chat_messages(session_id);
CREATE INDEX IF NOT EXISTS doc_chat_messages_role_idx    ON doc_chat_messages(role);
