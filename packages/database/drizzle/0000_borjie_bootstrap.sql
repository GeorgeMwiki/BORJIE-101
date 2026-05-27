-- =============================================================================
-- Migration 0000 — Borjie bootstrap
--
-- Creates the minimum schema 0003_mining_domain.sql needs to layer on top:
--   1. Extensions (postgis, vector; timescaledb + age optional)
--   2. Enums used by tenants/users + the mining domain
--   3. Core identity tables: tenants, organizations, users
--
-- This replaces the legacy property-domain 0001_initial.sql (~50 tables)
-- with a 3-table minimum that 0003 immediately augments.
--
-- Idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

-- TimescaleDB is optional in dev. cash_balances stays a regular table when
-- not loaded; the hypertable call in 0003 is wrapped in DO/EXCEPTION.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[borjie-bootstrap] timescaledb unavailable — cash_balances will be a plain table';
END$$;

-- Apache AGE for graph traversal is optional in v1 (we have temporal_relationships
-- in plain Postgres). Try to load; fall through if unavailable.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS age;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[borjie-bootstrap] apache age unavailable — temporal_relationships only';
END$$;

-- -----------------------------------------------------------------------------
-- 2. Enums (must be created before tables that reference them)
-- -----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE tenant_status AS ENUM ('pending', 'active', 'suspended', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE subscription_tier AS ENUM ('starter', 'growth', 'enterprise');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE borjie_plan AS ENUM ('mwanzo', 'mkulima', 'mfanyabiashara', 'kampuni', 'group');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('pending_activation', 'active', 'suspended', 'deactivated', 'locked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE borjie_user_role AS ENUM (
    'owner', 'admin', 'site_manager', 'supervisor', 'driver',
    'geologist', 'stores', 'qc_officer', 'buyer', 'borjie_team'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- 3. tenants
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  slug                 text NOT NULL,
  status               tenant_status NOT NULL DEFAULT 'pending',
  subscription_tier    subscription_tier NOT NULL DEFAULT 'starter',
  plan                 borjie_plan NOT NULL DEFAULT 'mkulima',
  primary_email        text NOT NULL,
  primary_phone        text,
  address_line1        text,
  address_line2        text,
  city                 text,
  state                text,
  postal_code          text,
  -- UNIV-4: column default = TZ launch beachhead seed; future jurisdictions write their own value
  country              text NOT NULL DEFAULT 'TZ',
  region               text NOT NULL DEFAULT 'af-south-1',
  settings             jsonb DEFAULT '{}'::jsonb,
  billing_settings     jsonb DEFAULT '{}'::jsonb,
  max_users            integer DEFAULT 5,
  current_users        integer DEFAULT 0,
  trial_ends_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  last_activity_at     timestamptz,
  created_by           text,
  updated_by           text,
  deleted_at           timestamptz,
  deleted_by           text
);

CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_idx ON tenants(slug);
CREATE INDEX IF NOT EXISTS tenants_status_idx ON tenants(status);
CREATE INDEX IF NOT EXISTS tenants_created_at_idx ON tenants(created_at);
CREATE INDEX IF NOT EXISTS tenants_country_idx ON tenants(country);

-- -----------------------------------------------------------------------------
-- 4. organizations — optional sub-tenancy (mining group → subsidiary companies)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS organizations (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id     text,
  code          text NOT NULL,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  attributes    jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizations_tenant_idx ON organizations(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_code_idx ON organizations(tenant_id, code);

-- -----------------------------------------------------------------------------
-- 5. users
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                          text PRIMARY KEY,
  tenant_id                   text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id             text REFERENCES organizations(id),
  email                       text NOT NULL,
  phone                       text,
  password_hash               text,
  first_name                  text NOT NULL,
  last_name                   text NOT NULL,
  display_name                text,
  avatar_url                  text,
  status                      user_status NOT NULL DEFAULT 'pending_activation',
  is_owner                    boolean NOT NULL DEFAULT false,
  mining_role                 borjie_user_role NOT NULL DEFAULT 'owner',
  nida_id                     text,
  biometric_template_hash     text,
  preferred_lang              text NOT NULL DEFAULT 'sw',
  mfa_enabled                 boolean NOT NULL DEFAULT false,
  mfa_secret                  text,
  failed_login_attempts       integer NOT NULL DEFAULT 0,
  locked_until                timestamptz,
  password_changed_at         timestamptz,
  must_change_password        boolean NOT NULL DEFAULT false,
  invitation_token            text,
  invitation_expires_at       timestamptz,
  invited_by                  text,
  last_login_at               timestamptz,
  last_activity_at            timestamptz,
  last_login_ip               text,
  preferences                 jsonb DEFAULT '{}'::jsonb,
  timezone                    text DEFAULT 'Africa/Dar_es_Salaam',
  locale                      text DEFAULT 'sw-TZ',
  activated_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text,
  updated_by                  text,
  deleted_at                  timestamptz,
  deleted_by                  text
);

CREATE INDEX IF NOT EXISTS users_tenant_idx ON users(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_tenant_idx ON users(tenant_id, email);
CREATE INDEX IF NOT EXISTS users_org_idx ON users(organization_id);
CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);
CREATE UNIQUE INDEX IF NOT EXISTS users_invitation_token_idx ON users(invitation_token)
  WHERE invitation_token IS NOT NULL;

COMMIT;
