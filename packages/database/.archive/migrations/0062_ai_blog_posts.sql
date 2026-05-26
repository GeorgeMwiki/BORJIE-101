-- =============================================================================
-- 0062: AI Blog Posts — Wave-12 (marketing-brain blog engine)
-- =============================================================================
-- Stores generated + operator-edited blog posts. tenantId IS NULL indicates a
-- platform-wide post (published on borjie.com). tenantId NOT NULL indicates
-- a tenant-specific post (e.g. an estate operator's portal-branded blog).
-- =============================================================================

CREATE TABLE IF NOT EXISTS ai_blog_posts (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  slug              TEXT NOT NULL,
  title             TEXT NOT NULL,
  excerpt           TEXT NOT NULL,
  body_md           TEXT NOT NULL,
  lang              TEXT NOT NULL CHECK (lang IN ('en', 'sw')),
  tags              TEXT[] NOT NULL DEFAULT '{}',
  published_at      TIMESTAMPTZ,
  generated_by      TEXT NOT NULL,
  edited_by         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique slug per tenant scope (platform posts share one namespace via NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_blog_posts_slug_tenant
  ON ai_blog_posts(COALESCE(tenant_id, ''), slug);

CREATE INDEX IF NOT EXISTS idx_ai_blog_posts_published
  ON ai_blog_posts(published_at DESC)
  WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_blog_posts_lang
  ON ai_blog_posts(lang, published_at DESC);
