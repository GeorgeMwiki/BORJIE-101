-- ─────────────────────────────────────────────────────────────────────
-- Migration 0162 — Owner skills marketplace (Phase E.7).
--
-- Owner-installable Skills: explicit, owner-curated workflows the brain
-- runs on cron / events / on-demand. Distinct from the platform-wide
-- skill_registry (Voyager procedural memory which is auto-learned).
--
-- Each row represents an INSTALL for a specific tenant. Author can be
-- platform-tier (NULL author_tenant_id, "MD-shipped") or community.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS owner_skills (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /** NULL = MD-authored platform skill. */
  author_tenant_id         UUID,
  installed_by_tenant_id   UUID NOT NULL,
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL,
  description              TEXT NOT NULL,
  prompt_template          TEXT NOT NULL,
  /** JSON array of allow-listed tool names. */
  tool_allowlist           JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** 'cron' | 'event' | 'manual' */
  trigger_kind             TEXT NOT NULL,
  trigger_config           JSONB DEFAULT '{}'::jsonb,
  enabled                  BOOLEAN NOT NULL DEFAULT FALSE,
  installed_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  last_run_at              TIMESTAMP,
  run_count                INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_owner_skills_installer_slug
  ON owner_skills (installed_by_tenant_id, slug);

CREATE INDEX IF NOT EXISTS idx_owner_skills_trigger_kind
  ON owner_skills (installed_by_tenant_id, trigger_kind);

CREATE INDEX IF NOT EXISTS idx_owner_skills_enabled
  ON owner_skills (installed_by_tenant_id, enabled);

COMMENT ON TABLE owner_skills IS
  'Owner-installable Skills marketplace — explicit workflows the brain runs on cron/event/manual triggers.';

COMMENT ON COLUMN owner_skills.author_tenant_id IS
  'NULL = MD-authored (platform-shipped). Otherwise the publishing tenant.';

COMMENT ON COLUMN owner_skills.trigger_kind IS
  'One of: cron | event | manual';
