-- ============================================================================
-- Migration 0172 — Universal tenant marketplace + multi-org tenancy.
--
-- Background:
--   Vision (Docs/requirements/VOICE_MEMO_2026-04-18_questionnaire_analysis.md
--   Section 4) — the tenant app is universal, not org-siloed. One download
--   reaches many organizations. A tenant joins an org via a special code
--   and may hold simultaneous tenancies across multiple orgs. The
--   marketplace exposes plots, buildings, units, AND tenders (Section 7)
--   to tenants browsing across orgs.
--
-- This migration introduces THREE additive surfaces — all
-- backwards-compatible (no destructive ALTERs):
--
--   1. `marketplace_visible` on `properties` + `units`
--      Org-side opt-in toggle. The tenant-facing marketplace router
--      filters listings to rows where the flag is TRUE — orgs control
--      what they publish.
--
--   2. `user_organizations` join table
--      A user may hold a `tenant`, `vendor`, or `prospect` relationship
--      with multiple orgs simultaneously. Each row carries a role + a
--      status, joined_at, and a free-form metadata blob (used by the
--      org-switcher UI to show "active leases count").
--
--      The `users.tenant_id` column stays — it represents the user's
--      HOME org (the one they signed up under). The join table layers
--      multi-org tenancy on top without breaking the single-org users
--      that already exist.
--
--   3. `org_join_codes` — opaque, single-use (or rate-limited) codes
--      that orgs hand out so tenants can self-enrol. The code maps to
--      an org_id + a role + an expiration. POST /v1/marketplace/join-org
--      consumes a code and inserts the corresponding
--      user_organizations row.
--
-- Tenant numbering note:
--   The repo uses `tenant_id` as the SaaS-customer-org identifier
--   throughout. To stay consistent, this migration uses `org_id`
--   (which is just a synonym for the saas tenant identifier) in the
--   new tables so a future read of the marketplace router is
--   unambiguous about role-of-tenant-vs-rental-tenant. Existing
--   columns named `tenant_id` are untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Marketplace visibility flags
-- ---------------------------------------------------------------------------

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS marketplace_visible BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS marketplace_visible BOOLEAN NOT NULL DEFAULT FALSE;

-- Marketplace search uses (marketplace_visible, city, type) as the
-- hot path. A partial index on visible-only rows keeps the index small
-- when the bulk of inventory is private.
CREATE INDEX IF NOT EXISTS idx_properties_marketplace_visible
  ON properties (city, type)
  WHERE marketplace_visible = TRUE;

CREATE INDEX IF NOT EXISTS idx_units_marketplace_visible
  ON units (property_id, type)
  WHERE marketplace_visible = TRUE;

-- ---------------------------------------------------------------------------
-- 2) user_organizations — multi-org tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_organizations (
  user_org_id   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id       TEXT NOT NULL,
  org_id        TEXT NOT NULL,
  /** Roles a user can hold relative to an org:
   *   - tenant  : holds (or has held) a lease
   *   - prospect: browsing / applied but not yet a tenant
   *   - vendor  : maintenance / service provider on tenders
   *
   *  A user may hold multiple roles for the same org over time —
   *  we keep status='inactive' rows for history.
   */
  role          TEXT NOT NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Active | inactive (the row stays for audit trail). */
  status        TEXT NOT NULL DEFAULT 'active',
  /** Free-form: { activeLeaseCount, lastInteractionAt, joinSource, ... } */
  metadata      JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT user_organizations_role_chk
    CHECK (role IN ('tenant', 'prospect', 'vendor')),
  CONSTRAINT user_organizations_status_chk
    CHECK (status IN ('active', 'inactive', 'revoked'))
);

-- A user gets ONE active row per (org, role). They can rejoin later
-- (status flips to active again) but never two rows for the same
-- (user, org, role) simultaneously.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_organizations_user_org_role
  ON user_organizations (user_id, org_id, role);

CREATE INDEX IF NOT EXISTS user_organizations_user_idx
  ON user_organizations (user_id);

CREATE INDEX IF NOT EXISTS user_organizations_org_idx
  ON user_organizations (org_id);

CREATE INDEX IF NOT EXISTS user_organizations_status_idx
  ON user_organizations (status)
  WHERE status = 'active';

-- ---------------------------------------------------------------------------
-- 3) org_join_codes — special codes that grant tenant access to an org
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_join_codes (
  join_code_id    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  /** Opaque code — case-insensitive, normalised to upper at INSERT.
   *  Caller hands this to a prospective tenant out-of-band. */
  code            TEXT NOT NULL,
  org_id          TEXT NOT NULL,
  /** Role granted by this code. Defaults to 'tenant' but vendors get
   *  their own scheme too. */
  role            TEXT NOT NULL DEFAULT 'tenant',
  /** Optional cap — NULL means unlimited use until expiry. */
  max_uses        INTEGER,
  uses_count      INTEGER NOT NULL DEFAULT 0,
  /** NULL means never expires. */
  expires_at      TIMESTAMPTZ,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Soft-delete: a revoked code can no longer be redeemed but the row
   *  stays for audit. */
  revoked_at      TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
  CONSTRAINT org_join_codes_role_chk
    CHECK (role IN ('tenant', 'prospect', 'vendor'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_org_join_codes_code
  ON org_join_codes (code);

CREATE INDEX IF NOT EXISTS org_join_codes_org_idx
  ON org_join_codes (org_id);

-- Active (non-revoked, non-expired, under-cap) lookups are the hot path.
CREATE INDEX IF NOT EXISTS org_join_codes_active_idx
  ON org_join_codes (code)
  WHERE revoked_at IS NULL;
