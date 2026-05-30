-- =============================================================================
-- 20260517 — Owner-Style Profiles
-- =============================================================================
-- Stores per-(tenant, owner) style profiles for the AI Managing Director.
-- The profile_json column carries the full OwnerStyleProfile (Zod-validated
-- at the application layer). RLS pins every read/write to the owner's own
-- row; service role bypasses for back-fill jobs.
--
-- Idempotent (IF NOT EXISTS) and wrapped in BEGIN/COMMIT.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS owner_style_profiles (
  tenant_id        TEXT NOT NULL,
  owner_user_id    TEXT NOT NULL,
  profile_json     JSONB NOT NULL,
  sample_size      INTEGER NOT NULL DEFAULT 0,
  confidence       DOUBLE PRECISION NOT NULL DEFAULT 0
                     CHECK (confidence >= 0 AND confidence <= 1),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_owner_style_profiles_tenant
  ON owner_style_profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_owner_style_profiles_updated
  ON owner_style_profiles (updated_at DESC);

ALTER TABLE owner_style_profiles ENABLE ROW LEVEL SECURITY;

-- Owners read their own profile.
DROP POLICY IF EXISTS owner_style_profiles_owner_select ON owner_style_profiles;
CREATE POLICY owner_style_profiles_owner_select
  ON owner_style_profiles
  FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND auth.uid()::text = owner_user_id
  );

-- Owners upsert their own profile.
DROP POLICY IF EXISTS owner_style_profiles_owner_write ON owner_style_profiles;
CREATE POLICY owner_style_profiles_owner_write
  ON owner_style_profiles
  FOR ALL
  USING (
    auth.role() = 'authenticated'
    AND auth.uid()::text = owner_user_id
  )
  WITH CHECK (
    auth.role() = 'authenticated'
    AND auth.uid()::text = owner_user_id
  );

-- Service role bypasses RLS (back-fill jobs, cross-owner admin tools).
DROP POLICY IF EXISTS owner_style_profiles_service_all ON owner_style_profiles;
CREATE POLICY owner_style_profiles_service_all
  ON owner_style_profiles
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE owner_style_profiles IS
  'Per-(tenant, owner) communication-style profile used by the AI MD prompt + output adapters.';
COMMENT ON COLUMN owner_style_profiles.profile_json IS
  'Zod-validated OwnerStyleProfile (Dirichlet posterior over each style dimension).';

COMMIT;
