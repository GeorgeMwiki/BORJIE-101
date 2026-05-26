-- =============================================================================
-- Migration 0020 — Media Generation schema (Wave 17E)
--
-- Companion to Docs/DESIGN/MEDIA_GENERATION_SPEC.md. Adds the
-- persistence substrate for Mr. Mwikila's media-generation layer:
-- recipe registry, produced artefacts, safety-scan ledger, engagement
-- event stream consumed by the future media-evolution-worker.
--
--   1. media_recipes           — versioned recipe registry (global).
--                                Closed set of MediaClass values per spec.
--   2. media_artifacts         — produced artefacts with checksum,
--                                provenance, audit_hash, and Tier-2
--                                approval state. Tenant-scoped.
--   3. media_safety_scans      — NSFW / deepfake / brand-violation
--                                results, one row per scanner. Tenant-
--                                scoped via artifact_id parent.
--   4. media_engagement_events — CTR / share / revision / rejection
--                                signals consumed by services/
--                                media-evolution-worker (future).
--
-- Patterns mirror migration 0019_document_composition.sql: idempotent
-- (IF NOT EXISTS + DO blocks), tenant-scoped tables under canonical
-- `app.tenant_id` GUC RLS, `media_recipes` global + RLS-off.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. media_recipes — versioned recipe registry (global)
-- -----------------------------------------------------------------------------
-- Recipes are product-wide config, like tab_recipes + document_recipes.
-- Live recipes never mutate in place — improvement proposals create
-- version n+1 in shadow state, promoted to live only after owner
-- approval.

CREATE TABLE IF NOT EXISTS media_recipes (
  id                    text NOT NULL,
  version               integer NOT NULL,
  status                text NOT NULL,
  class                 text NOT NULL,
  compose_fn_ref        text NOT NULL,
  required_inputs       jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_format         text NOT NULL,
  target_aspect_ratio   text NOT NULL,
  target_duration_sec   integer,
  authority_tier        smallint NOT NULL,
  brand                 text NOT NULL DEFAULT 'borjie',
  approval_required     boolean NOT NULL DEFAULT true,
  promoted_at           timestamptz,
  promoted_by           text REFERENCES users(id) ON DELETE SET NULL,
  locked_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, version),
  CONSTRAINT media_recipes_brand_chk CHECK (brand = 'borjie'),
  CONSTRAINT media_recipes_authority_chk CHECK (authority_tier IN (0,1,2)),
  CONSTRAINT media_recipes_status_chk
    CHECK (status IN ('draft','shadow','live','locked','deprecated')),
  CONSTRAINT media_recipes_format_chk
    CHECK (output_format IN ('image','short_video','lipsync_video')),
  CONSTRAINT media_recipes_aspect_chk
    CHECK (target_aspect_ratio IN ('1:1','4:5','9:16','16:9','21:9')),
  CONSTRAINT media_recipes_class_chk
    CHECK (class IN (
      'marketing_still','marketplace_listing_hero','site_visualisation',
      'briefing_thumbnail','investor_brand_video',
      'social_post_still','social_post_short_video',
      'tutorial_lipsync_video','avatar_talking_head'
    )),
  CONSTRAINT media_recipes_duration_chk
    CHECK (target_duration_sec IS NULL OR target_duration_sec > 0)
);

CREATE INDEX IF NOT EXISTS media_recipes_status_idx ON media_recipes(status);
CREATE INDEX IF NOT EXISTS media_recipes_class_idx ON media_recipes(class);
CREATE INDEX IF NOT EXISTS media_recipes_live_idx
  ON media_recipes(id, version) WHERE status = 'live';
CREATE INDEX IF NOT EXISTS media_recipes_promoted_by_idx
  ON media_recipes(promoted_by);

-- media_recipes is global product config — RLS off, service-account write.
ALTER TABLE media_recipes DISABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2. media_artifacts — produced artefacts with audit chain + approval
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS media_artifacts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipe_id           text NOT NULL,
  recipe_version      integer NOT NULL,
  format              text NOT NULL,
  storage_key         text NOT NULL,
  thumb_storage_key   text,
  checksum            text NOT NULL,
  provenance          jsonb NOT NULL,
  span_citations      jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_hash          text NOT NULL,
  approval_state      text NOT NULL DEFAULT 'pending',
  approved_by         text REFERENCES users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_artifacts_format_chk
    CHECK (format IN ('image','short_video','lipsync_video')),
  CONSTRAINT media_artifacts_approval_chk
    CHECK (approval_state IN ('pending','approved','rejected','auto_published')),
  CONSTRAINT media_artifacts_recipe_fk
    FOREIGN KEY (recipe_id, recipe_version)
    REFERENCES media_recipes(id, version)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS media_artifacts_recipe_idx
  ON media_artifacts(recipe_id, recipe_version);
CREATE INDEX IF NOT EXISTS media_artifacts_tenant_generated_idx
  ON media_artifacts(tenant_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS media_artifacts_approval_idx
  ON media_artifacts(approval_state, generated_at DESC);
CREATE INDEX IF NOT EXISTS media_artifacts_pending_idx
  ON media_artifacts(tenant_id, generated_at DESC)
  WHERE approval_state = 'pending';
CREATE INDEX IF NOT EXISTS media_artifacts_audit_hash_idx
  ON media_artifacts(audit_hash);
CREATE INDEX IF NOT EXISTS media_artifacts_approved_by_idx
  ON media_artifacts(approved_by);

-- -----------------------------------------------------------------------------
-- 3. media_safety_scans — NSFW / deepfake / brand-violation results
-- -----------------------------------------------------------------------------
-- One row per scanner per artifact. The composer writes these
-- pre-publication; the dispatcher gates publication on the per-tier
-- thresholds defined in MEDIA_GENERATION_SPEC §7.

CREATE TABLE IF NOT EXISTS media_safety_scans (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id               uuid NOT NULL REFERENCES media_artifacts(id) ON DELETE CASCADE,
  tenant_id                 text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scanner                   text NOT NULL,
  nsfw_probability          numeric(4,3),
  deepfake_probability      numeric(4,3),
  brand_violation_flags     text[] NOT NULL DEFAULT ARRAY[]::text[],
  raw_result                jsonb NOT NULL DEFAULT '{}'::jsonb,
  scanned_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_safety_scans_nsfw_chk
    CHECK (nsfw_probability IS NULL OR (nsfw_probability >= 0 AND nsfw_probability <= 1)),
  CONSTRAINT media_safety_scans_deepfake_chk
    CHECK (deepfake_probability IS NULL OR (deepfake_probability >= 0 AND deepfake_probability <= 1))
);

CREATE INDEX IF NOT EXISTS media_safety_scans_artifact_idx
  ON media_safety_scans(artifact_id);
CREATE INDEX IF NOT EXISTS media_safety_scans_tenant_idx
  ON media_safety_scans(tenant_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS media_safety_scans_scanner_idx
  ON media_safety_scans(scanner, scanned_at DESC);

-- -----------------------------------------------------------------------------
-- 4. media_engagement_events — signals consumed by media-evolution-worker
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS media_engagement_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id     uuid NOT NULL REFERENCES media_artifacts(id) ON DELETE CASCADE,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_kind      text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_engagement_events_kind_chk
    CHECK (event_kind IN (
      'impression','click','share','conversion',
      'owner_rejection','owner_approval','owner_revision_request',
      'auto_publish','tier_downgrade'
    ))
);

CREATE INDEX IF NOT EXISTS media_engagement_events_artifact_kind_idx
  ON media_engagement_events(artifact_id, event_kind);
CREATE INDEX IF NOT EXISTS media_engagement_events_tenant_recorded_idx
  ON media_engagement_events(tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS media_engagement_events_kind_recorded_idx
  ON media_engagement_events(event_kind, recorded_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Row Level Security — tenant-scoped tables
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'media_artifacts',
    'media_safety_scans',
    'media_engagement_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      'USING (tenant_id = current_setting(''app.tenant_id'', true));',
      t
    );
  END LOOP;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0020_media_generation.sql
-- =============================================================================
