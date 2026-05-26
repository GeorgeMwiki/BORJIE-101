-- =============================================================================
-- Migration 0047 — Self-Improve (meta-learning + DP federation) + OMNI-P2
--                 (six social-platform connectors).
--
-- Specs:
--   Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md
--   Docs/DESIGN/OMNI_P2_SOCIAL_CONNECTORS_SPEC.md
--
-- Uses connector_credentials, connector_cursors from 0042 (OMNI-P0
-- Batch 1). For independent application this migration declares the
-- two shared tables idempotently (`CREATE TABLE IF NOT EXISTS`) so it
-- is safe in both orderings; if 0042 lands first, the IF NOT EXISTS
-- is a no-op; if this migration lands first, the structure is the
-- same. Note: 0042's eventual definition is the source of truth — if
-- there is ever a schema-drift between the two, the canonical
-- migration is 0042 and the rows here are pure type stubs.
--
-- Ten tables total:
--   - meta_learning_runs          one row per conductor run
--   - meta_learning_examples      one row per curated example
--   - dp_charges                  one row per DP operation
--   - instagram_posts             per-post ingest, idempotent
--   - facebook_posts              per-post ingest, idempotent
--   - tiktok_posts                per-post ingest, idempotent
--   - x_posts                     per-tweet ingest, idempotent
--   - linkedin_posts              per-post ingest, idempotent
--   - youtube_videos              per-video ingest, idempotent
--
-- And two shared tables guarded by IF NOT EXISTS (from 0042):
--   - connector_credentials
--   - connector_cursors
--
-- All ten new tables are tenant-scoped with RLS via the canonical
-- `current_setting('app.tenant_id', true)` GUC pattern. Idempotent
-- (`IF NOT EXISTS` + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared connector substrate (from 0042; declared idempotently here).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS connector_credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  provider            text NOT NULL,
  /** Encrypted bytea: AES-GCM via @borjie/database EncryptionPort. */
  access_token        bytea,
  refresh_token       bytea,
  expires_at          timestamptz,
  scopes              text[] NOT NULL DEFAULT ARRAY[]::text[],
  /** Tenant-specific salt for joinable-identifier hashing. */
  pii_salt            bytea,
  legacy_salts        jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** ok | auth-failed | revoked */
  status              text NOT NULL DEFAULT 'ok',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL,
  UNIQUE (tenant_id, provider)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'connector_credentials'
       AND policyname = 'connector_credentials_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY';
    CREATE POLICY connector_credentials_tenant_isolation ON connector_credentials
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS connector_cursors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL,
  provider            text NOT NULL,
  /** Scope key — e.g. account ID, channel ID. */
  scope_key           text NOT NULL,
  /** Opaque cursor payload — provider-specific. */
  cursor              jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_polled_at      timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  audit_hash          text NOT NULL,
  UNIQUE (tenant_id, provider, scope_key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'connector_cursors'
       AND policyname = 'connector_cursors_tenant_isolation'
  ) THEN
    EXECUTE 'ALTER TABLE connector_cursors ENABLE ROW LEVEL SECURITY';
    CREATE POLICY connector_cursors_tenant_isolation ON connector_cursors
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 1. meta_learning_runs — one row per meta-learning-conductor run
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meta_learning_runs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text NOT NULL,
  started_at              timestamptz NOT NULL DEFAULT now(),
  ended_at                timestamptz,
  /** scheduled | running | succeeded | failed */
  status                  text NOT NULL DEFAULT 'scheduled',
  capability_id           uuid NOT NULL,
  examples_count          integer NOT NULL DEFAULT 0,
  eval_metric_before      real,
  eval_metric_after       real,
  /** promote | demote | no-op | rollback */
  decision                text,
  audit_hash              text NOT NULL,
  prev_hash               text
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_learning_runs_status_chk'
  ) THEN
    ALTER TABLE meta_learning_runs
      ADD CONSTRAINT meta_learning_runs_status_chk
      CHECK (status IN ('scheduled','running','succeeded','failed'));
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'meta_learning_runs_decision_chk'
  ) THEN
    ALTER TABLE meta_learning_runs
      ADD CONSTRAINT meta_learning_runs_decision_chk
      CHECK (decision IS NULL OR decision IN ('promote','demote','no-op','rollback'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_meta_learning_runs_tenant_started
  ON meta_learning_runs (tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_learning_runs_tenant_capability
  ON meta_learning_runs (tenant_id, capability_id, started_at DESC);

ALTER TABLE meta_learning_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'meta_learning_runs'
       AND policyname = 'meta_learning_runs_tenant_isolation'
  ) THEN
    CREATE POLICY meta_learning_runs_tenant_isolation ON meta_learning_runs
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 2. meta_learning_examples — one row per curated example
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS meta_learning_examples (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  meta_run_id     uuid NOT NULL REFERENCES meta_learning_runs(id) ON DELETE CASCADE,
  prompt          jsonb NOT NULL,
  completion      jsonb NOT NULL,
  reward          real NOT NULL,
  included        boolean NOT NULL DEFAULT true,
  audit_hash      text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_learning_examples_run
  ON meta_learning_examples (meta_run_id);

CREATE INDEX IF NOT EXISTS idx_meta_learning_examples_tenant_run
  ON meta_learning_examples (tenant_id, meta_run_id);

ALTER TABLE meta_learning_examples ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'meta_learning_examples'
       AND policyname = 'meta_learning_examples_tenant_isolation'
  ) THEN
    CREATE POLICY meta_learning_examples_tenant_isolation ON meta_learning_examples
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 3. dp_charges — one row per DP operation
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dp_charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  /** First day of the budget period (typically quarter). */
  period_start    date NOT NULL,
  /** epsilon spent on this operation; delta tracked alongside. */
  epsilon_delta   numeric(20, 12) NOT NULL,
  /** Free-text operation kind: dp-mean | dp-sum | dp-count | dp-gradient | ... */
  operation       text NOT NULL,
  op_id           text NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dp_charges_epsilon_nonneg'
  ) THEN
    ALTER TABLE dp_charges
      ADD CONSTRAINT dp_charges_epsilon_nonneg
      CHECK (epsilon_delta >= 0);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_dp_charges_tenant_period
  ON dp_charges (tenant_id, period_start);

CREATE INDEX IF NOT EXISTS idx_dp_charges_tenant_recorded
  ON dp_charges (tenant_id, recorded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_dp_charges_tenant_op
  ON dp_charges (tenant_id, op_id);

ALTER TABLE dp_charges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'dp_charges'
       AND policyname = 'dp_charges_tenant_isolation'
  ) THEN
    CREATE POLICY dp_charges_tenant_isolation ON dp_charges
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 4. instagram_posts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS instagram_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  account         text NOT NULL,
  post_id         text NOT NULL,
  /** image | video | carousel_album | reels | story */
  kind            text NOT NULL,
  caption         text,
  media_urls      text[] NOT NULL DEFAULT ARRAY[]::text[],
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at       timestamptz,
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  UNIQUE (tenant_id, account, post_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_posts_tenant_posted
  ON instagram_posts (tenant_id, posted_at DESC);

ALTER TABLE instagram_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'instagram_posts'
       AND policyname = 'instagram_posts_tenant_isolation'
  ) THEN
    CREATE POLICY instagram_posts_tenant_isolation ON instagram_posts
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 5. facebook_posts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS facebook_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  account         text NOT NULL,
  post_id         text NOT NULL,
  kind            text NOT NULL,
  caption         text,
  media_urls      text[] NOT NULL DEFAULT ARRAY[]::text[],
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at       timestamptz,
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  UNIQUE (tenant_id, account, post_id)
);

CREATE INDEX IF NOT EXISTS idx_facebook_posts_tenant_posted
  ON facebook_posts (tenant_id, posted_at DESC);

ALTER TABLE facebook_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'facebook_posts'
       AND policyname = 'facebook_posts_tenant_isolation'
  ) THEN
    CREATE POLICY facebook_posts_tenant_isolation ON facebook_posts
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 6. tiktok_posts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tiktok_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  account         text NOT NULL,
  post_id         text NOT NULL,
  kind            text NOT NULL,
  caption         text,
  media_urls      text[] NOT NULL DEFAULT ARRAY[]::text[],
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at       timestamptz,
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  UNIQUE (tenant_id, account, post_id)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_posts_tenant_posted
  ON tiktok_posts (tenant_id, posted_at DESC);

ALTER TABLE tiktok_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'tiktok_posts'
       AND policyname = 'tiktok_posts_tenant_isolation'
  ) THEN
    CREATE POLICY tiktok_posts_tenant_isolation ON tiktok_posts
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 7. x_posts (formerly Twitter) — column "text" for tweet body
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS x_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  account         text NOT NULL,
  post_id         text NOT NULL,
  kind            text NOT NULL,
  text            text,
  media_urls      text[] NOT NULL DEFAULT ARRAY[]::text[],
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at       timestamptz,
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  UNIQUE (tenant_id, account, post_id)
);

CREATE INDEX IF NOT EXISTS idx_x_posts_tenant_posted
  ON x_posts (tenant_id, posted_at DESC);

ALTER TABLE x_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'x_posts'
       AND policyname = 'x_posts_tenant_isolation'
  ) THEN
    CREATE POLICY x_posts_tenant_isolation ON x_posts
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 8. linkedin_posts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS linkedin_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  account         text NOT NULL,
  post_id         text NOT NULL,
  kind            text NOT NULL,
  caption         text,
  media_urls      text[] NOT NULL DEFAULT ARRAY[]::text[],
  metrics         jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at       timestamptz,
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  UNIQUE (tenant_id, account, post_id)
);

CREATE INDEX IF NOT EXISTS idx_linkedin_posts_tenant_posted
  ON linkedin_posts (tenant_id, posted_at DESC);

ALTER TABLE linkedin_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'linkedin_posts'
       AND policyname = 'linkedin_posts_tenant_isolation'
  ) THEN
    CREATE POLICY linkedin_posts_tenant_isolation ON linkedin_posts
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- 9. youtube_videos
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS youtube_videos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  channel_id      text NOT NULL,
  video_id        text NOT NULL,
  title           text,
  description     text,
  duration_s      integer,
  view_count      bigint,
  like_count      bigint,
  comment_count   bigint,
  published_at    timestamptz,
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  audit_hash      text NOT NULL,
  UNIQUE (tenant_id, channel_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_youtube_videos_tenant_published
  ON youtube_videos (tenant_id, published_at DESC);

ALTER TABLE youtube_videos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'youtube_videos'
       AND policyname = 'youtube_videos_tenant_isolation'
  ) THEN
    CREATE POLICY youtube_videos_tenant_isolation ON youtube_videos
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END$$;

COMMIT;
