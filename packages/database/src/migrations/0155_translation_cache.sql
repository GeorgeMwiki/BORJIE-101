-- =============================================================================
-- Migration 0155 - Translation Cache (shared per-tenant key/value)
--
-- Companion to `@borjie/translation` facade
-- (`packages/translation/src/drizzle-cache.ts`). The facade keys lookups
-- on (tenantId, sourceText, sourceLang, targetLang, register, surface);
-- to keep the unique index narrow we materialise the key as a SHA-256
-- `content_hash` of the canonical join of those fields. Repeated
-- translations short-circuit at the cache before hitting Claude /
-- Gemini / NLLB.
--
-- Append-only / forward-only / IMMUTABLE per CLAUDE.md hard rule.
--
-- RLS: shared-by-design across tenants for translations of identical
-- source strings (cache is content-addressed by hash, NOT tenant). We
-- still record the originating tenant_id for telemetry but the SELECT
-- policy permits cross-tenant reads — a translation of "Welcome" is
-- the same for every tenant. Writes are auth-scoped (only the inserting
-- tenant can update its own row).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS translation_cache (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Content hash: sha256(sourceLang||targetLang||register||surface||sourceText). */
  content_hash    text        NOT NULL,
  tenant_id       text,                                       -- originator (nullable for platform-wide entries)
  source_lang     text        NOT NULL,
  target_lang     text        NOT NULL,
  register        text        NOT NULL,
  surface         text        NOT NULL,
  source_text     text        NOT NULL,
  target_text     text        NOT NULL,
  provider        text        NOT NULL,
  glossary_version text       NOT NULL DEFAULT 'v1',
  hits            integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz NOT NULL DEFAULT now()
);

-- Cache key: identical content -> identical translation row, regardless of tenant
CREATE UNIQUE INDEX IF NOT EXISTS uq_translation_cache_content
  ON translation_cache (content_hash);

-- Eviction / housekeeping
CREATE INDEX IF NOT EXISTS idx_translation_cache_last_used
  ON translation_cache (last_used_at DESC);

CREATE INDEX IF NOT EXISTS idx_translation_cache_lang_pair
  ON translation_cache (source_lang, target_lang);

ALTER TABLE translation_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_cache FORCE ROW LEVEL SECURITY;

-- Read: shared across tenants (content-addressed cache).
CREATE POLICY translation_cache_read_all
  ON translation_cache
  FOR SELECT
  USING (true);

-- Write: insertion is open; updates pinned to the originating tenant.
CREATE POLICY translation_cache_insert
  ON translation_cache
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY translation_cache_update
  ON translation_cache
  FOR UPDATE
  USING (
    tenant_id IS NULL
    OR tenant_id = current_setting('app.current_tenant_id', true)
  );

COMMIT;
