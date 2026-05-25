-- =============================================================================
-- 0108: Document entity + obligation extraction (Agent PhL — doc-intelligence)
-- =============================================================================
-- Structured extraction of entities (parties, properties, units, dates,
-- amounts), obligations (who must do what by when), and risk flags from any
-- uploaded document. Works in any language — language is LLM-detected and
-- stored per row (ISO-639-1/-2) so downstream dashboards are polyglot-safe.
--
-- Citation discipline: every entity + obligation carries a `span_start` /
-- `span_end` character range into the source document's canonical text so
-- the UI can highlight "this sentence is where this obligation lives".
--
-- Semantic memory cross-reference: `embedding_ref` is an opaque handle into
-- the pgvector memory table — the extractor writes the entity embedding via
-- the memory port, NOT directly into this table, to keep the schema
-- vector-dialect-agnostic for Postgres deployments without pgvector.
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_entities (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id         TEXT NOT NULL,
  entity_kind         TEXT NOT NULL CHECK (
                        entity_kind IN (
                          'party', 'property', 'unit', 'date',
                          'amount', 'currency', 'jurisdiction',
                          'contract_kind', 'reference', 'other'
                        )
                      ),
  entity_value        TEXT NOT NULL,                             -- normalized value
  entity_raw          TEXT,                                      -- as-written in document
  normalized_form     JSONB NOT NULL DEFAULT '{}'::jsonb,        -- structured normalization
  language_code       TEXT,                                      -- ISO-639-1/-2, LLM-detected
  span_start          INTEGER,                                   -- char offset into canonical text
  span_end            INTEGER,
  confidence          DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  embedding_ref       TEXT,                                      -- opaque handle to semantic memory
  model_version       TEXT NOT NULL,
  prompt_hash         TEXT NOT NULL,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_entities_document
  ON document_entities (tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_document_entities_kind
  ON document_entities (tenant_id, entity_kind, created_at DESC);

-- Obligations: who must do what by when, and what happens if they miss it
CREATE TABLE IF NOT EXISTS document_obligations (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id         TEXT NOT NULL,
  obligor             TEXT NOT NULL,                             -- who must perform
  obligee             TEXT,                                      -- who benefits
  action_summary      TEXT NOT NULL,                             -- concise description
  due_date            DATE,                                      -- NULL for open-ended
  recurrence          TEXT,                                      -- 'monthly' | 'annual' | NULL
  consequence_if_missed TEXT,                                    -- penalty / default terms
  risk_flags          JSONB NOT NULL DEFAULT '[]'::jsonb,        -- ['auto_renew', 'unlimited_liability', ...]
  language_code       TEXT,
  span_start          INTEGER,
  span_end            INTEGER,
  confidence          DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  model_version       TEXT NOT NULL,
  prompt_hash         TEXT NOT NULL,
  explanation         TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_obligations_document
  ON document_obligations (tenant_id, document_id);
CREATE INDEX IF NOT EXISTS idx_document_obligations_due
  ON document_obligations (tenant_id, due_date)
  WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_document_obligations_risk
  ON document_obligations USING GIN (risk_flags);
