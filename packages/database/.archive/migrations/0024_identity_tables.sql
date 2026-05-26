-- =============================================================================
-- 0024: Identity Tables — Cross-Org Tenant Identity + Multi-Org
-- =============================================================================
-- Introduces three tables that together implement federated login without
-- breaking per-tenant data isolation (Conflict 2):
--
--   * tenant_identities — one row per real human, keyed by E.164 phone.
--       Lives outside any platform tenant; owns cross-org identity.
--   * org_memberships   — per-org join record (tenant_identity x org).
--       Each row pairs 1:1 with a shadow row in `users` via user_id, so the
--       existing RBAC / audit / data pipeline continues to resolve normally.
--   * invite_codes      — redeemable tokens; redeem is atomic and creates
--       both the membership row and its shadow user row together.
--
-- This migration is purely additive. Existing users / sessions / RBAC rows
-- are untouched.
-- =============================================================================

-- Status enums (idempotent guard: DO blocks with NOT EXISTS checks) ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_identity_status') THEN
    CREATE TYPE tenant_identity_status AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_membership_status') THEN
    CREATE TYPE org_membership_status AS ENUM ('ACTIVE', 'LEFT', 'BLOCKED');
  END IF;
END$$;

-- tenant_identities ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenant_identities (
  id                  TEXT PRIMARY KEY,
  phone_normalized    TEXT NOT NULL,
  phone_country_code  TEXT NOT NULL,
  email               TEXT,
  email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  profile             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              tenant_identity_status NOT NULL DEFAULT 'ACTIVE',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at    TIMESTAMPTZ,
  merged_into_id      TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_identities_phone_idx
  ON tenant_identities (phone_normalized);
CREATE INDEX IF NOT EXISTS tenant_identities_status_idx
  ON tenant_identities (status);
CREATE INDEX IF NOT EXISTS tenant_identities_email_idx
  ON tenant_identities (email);

-- org_memberships -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_memberships (
  id                    TEXT PRIMARY KEY,
  tenant_identity_id    TEXT NOT NULL REFERENCES tenant_identities(id) ON DELETE CASCADE,
  organization_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform_tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                org_membership_status NOT NULL DEFAULT 'ACTIVE',
  nickname              TEXT,
  joined_via_invite_code TEXT,
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at               TIMESTAMPTZ,
  blocked_at            TIMESTAMPTZ,
  block_reason          TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS org_memberships_identity_org_idx
  ON org_memberships (tenant_identity_id, organization_id);
CREATE INDEX IF NOT EXISTS org_memberships_identity_idx
  ON org_memberships (tenant_identity_id);
CREATE INDEX IF NOT EXISTS org_memberships_org_idx
  ON org_memberships (organization_id);
CREATE INDEX IF NOT EXISTS org_memberships_platform_tenant_idx
  ON org_memberships (platform_tenant_id);
CREATE INDEX IF NOT EXISTS org_memberships_user_idx
  ON org_memberships (user_id);
CREATE INDEX IF NOT EXISTS org_memberships_status_idx
  ON org_memberships (status);

-- invite_codes --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invite_codes (
  code                TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  platform_tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  issued_by           TEXT NOT NULL REFERENCES users(id),
  issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  max_redemptions     INTEGER,
  redemptions_used    INTEGER NOT NULL DEFAULT 0,
  default_role_id     TEXT NOT NULL,
  attachment_hints    JSONB,
  revoked_at          TIMESTAMPTZ,
  revoked_by          TEXT,
  CONSTRAINT invite_codes_redemptions_nonneg CHECK (redemptions_used >= 0),
  CONSTRAINT invite_codes_max_redemptions_pos CHECK (
    max_redemptions IS NULL OR max_redemptions > 0
  )
);

CREATE INDEX IF NOT EXISTS invite_codes_org_idx
  ON invite_codes (organization_id);
CREATE INDEX IF NOT EXISTS invite_codes_platform_tenant_idx
  ON invite_codes (platform_tenant_id);
CREATE INDEX IF NOT EXISTS invite_codes_issued_by_idx
  ON invite_codes (issued_by);
CREATE INDEX IF NOT EXISTS invite_codes_expires_at_idx
  ON invite_codes (expires_at);

-- End of 0024
