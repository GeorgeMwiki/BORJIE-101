-- =============================================================================
-- Migration 0288 — document_entities + document_obligations (Agent PhL —
-- doc-intelligence durable store).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The AI-native doc-intelligence capability (`@borjie/ai-copilot/ai-native`
-- namespace `DocIntelligence`) runs a REAL Anthropic extraction over an
-- uploaded mining document: language detection (any ISO-639-1/-2 — never
-- hardcoded to en/sw), entities (parties, dates, amounts, jurisdictions, ...),
-- and obligations (who must do what by when, with risk flags). Every entity and
-- obligation cites a `span_start`/`span_end` character range into the canonical
-- document text so the UI can highlight the exact source line.
--
-- Until now the extraction persisted ONLY to an in-process per-tenant map
-- (`services/api-gateway/src/composition/ai-native/in-memory-repos.ts`) because
-- the durable tables lived only in the archived BossNyumba tree
-- (`packages/database/.archive/migrations/0108`). This migration stands up the
-- two real tables so an extraction survives a restart and is shared across
-- replicas. The shapes mirror the `ExtractedEntity` / `ExtractedObligation`
-- ports exactly (doc-intelligence/types.ts).
--
-- Semantic-memory cross-reference: `embedding_ref` is an opaque handle into the
-- pgvector memory layer — the extractor writes the embedding via the memory
-- port, NOT directly here, keeping this schema vector-dialect-agnostic.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0285 / 0135):
--   tenant_id is TEXT; FORCE ROW LEVEL SECURITY + a tenant policy on the
--   canonical `app.current_tenant_id` GUC on BOTH tables. Bare compare (no
--   cast) because tenant_id is already TEXT. NEVER the legacy app.tenant_id.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): nothing here is money — extracted
-- amounts/currencies are stored as free-text entity values exactly as written.
--
-- ID DISCIPLINE: `id` is TEXT (the PhL `generateId` helper), matching the row
-- ports' `id: string` — NOT a uuid default.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule). Every object uses CREATE
-- TABLE IF NOT EXISTS / guarded DO-blocks / CREATE INDEX IF NOT EXISTS, and a
-- pg_roles guard around the anon REVOKE. On a fully-migrated DB this is a pure
-- no-op. References only pre-existing infra (`tenants`, pgcrypto).
--
-- Companion files:
--   * packages/database/src/schemas/ai-native-document-intelligence.schema.ts
--   * services/api-gateway/src/composition/ai-native/drizzle-repos.ts
--   * services/api-gateway/src/composition/ai-native-wiring.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- document_entities — parties, dates, amounts, jurisdictions, ... per document.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_entities (
  id              text        PRIMARY KEY,
  tenant_id       text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id     text        NOT NULL,
  entity_kind     text        NOT NULL,
  -- Normalized value (what the entity means).
  entity_value    text        NOT NULL,
  -- As-written in the document (verbatim source span).
  entity_raw      text,
  -- Structured normalization (e.g. parsed date parts, parsed amount).
  normalized_form jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- LLM-detected language of this span (ISO-639-1/-2). NULL when undetected.
  language_code   text,
  -- Character offsets into the canonical document text (for UI highlight).
  span_start      integer,
  span_end        integer,
  confidence      double precision,
  -- Opaque handle into the pgvector semantic-memory layer (written elsewhere).
  embedding_ref   text,
  model_version   text        NOT NULL,
  prompt_hash     text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_entities_entity_kind_chk'
  ) THEN
    ALTER TABLE document_entities
      ADD CONSTRAINT document_entities_entity_kind_chk
      CHECK (entity_kind IN (
        'party', 'property', 'unit', 'date', 'amount', 'currency',
        'jurisdiction', 'contract_kind', 'reference', 'other'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_entities_confidence_chk'
  ) THEN
    ALTER TABLE document_entities
      ADD CONSTRAINT document_entities_confidence_chk
      CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_entities_tenant_document
  ON document_entities (tenant_id, document_id);

CREATE INDEX IF NOT EXISTS idx_document_entities_tenant_kind
  ON document_entities (tenant_id, entity_kind, created_at DESC);

ALTER TABLE document_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_entities FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'document_entities'
       AND policyname = 'document_entities_tenant_isolation'
  ) THEN
    CREATE POLICY document_entities_tenant_isolation
      ON document_entities
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- document_obligations — who must do what by when, with risk flags.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS document_obligations (
  id                    text        PRIMARY KEY,
  tenant_id             text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id           text        NOT NULL,
  -- Who must perform the action.
  obligor               text        NOT NULL,
  -- Who benefits (NULL for open obligations).
  obligee               text,
  action_summary        text        NOT NULL,
  -- YYYY-MM-DD; NULL for open-ended obligations.
  due_date              date,
  -- e.g. 'monthly' | 'annual' | NULL.
  recurrence            text,
  consequence_if_missed text,
  -- ['auto_renew', 'unlimited_liability', 'ambiguous_clause', ...].
  risk_flags            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  language_code         text,
  span_start            integer,
  span_end              integer,
  confidence            double precision,
  model_version         text        NOT NULL,
  prompt_hash           text        NOT NULL,
  explanation           text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'document_obligations_confidence_chk'
  ) THEN
    ALTER TABLE document_obligations
      ADD CONSTRAINT document_obligations_confidence_chk
      CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_obligations_tenant_document
  ON document_obligations (tenant_id, document_id);

CREATE INDEX IF NOT EXISTS idx_document_obligations_tenant_due
  ON document_obligations (tenant_id, due_date)
  WHERE due_date IS NOT NULL;

ALTER TABLE document_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_obligations FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'document_obligations'
       AND policyname = 'document_obligations_tenant_isolation'
  ) THEN
    CREATE POLICY document_obligations_tenant_isolation
      ON document_obligations
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.document_entities FROM anon;';
    EXECUTE 'REVOKE ALL ON public.document_obligations FROM anon;';
  END IF;
END $$;

COMMIT;
