-- =============================================================================
-- Migration 0318 — break-glass operator-access spine (INV-A / FIRE-1, FIRE-2).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- INV-A (admin/owner control-plane vs data-plane wall) MANDATES that Borjie
-- staff support access to a tenant's business data is BREAK-GLASS ONLY:
-- explicit request + tenant CONSENT + TIME-BOXED grant + every access
-- hash-chain AUDITED + tenant-VISIBLE. The `frontier-admin-data-boundary`
-- dossier (V5) found this spine ABSENT anywhere in the repo — a grep for
-- break-glass / jit / operator-access returned zero implementation files —
-- so every cross-tenant read the admin console performs (the /warehouse,
-- /decision-trace service-role, support-tickets/daily-brief content, and
-- /data-privacy leaks) happens WITHOUT the consented/time-boxed/tenant-visible
-- gate the invariant requires.
--
-- This migration creates the two durable tables the spine needs:
--
--   * operator_access_grants — one row per support access request. Default
--     DENY: a grant is usable ONLY after the owning tenant CONSENTS
--     (status pending → active), carries a machine-readable justification
--     code (mirrors Google Key Access Justifications), is scoped to ONE
--     tenant + a closed list of scopes, and self-expires at `expires_at`
--     (time-boxed). Revocation is a status flip; nothing is deleted.
--
--   * operator_access_log — append-only, SHA-256 hash-chained record of
--     every business-data access performed under an active grant
--     (Access-Transparency). Each row links to the prior row for the same
--     tenant via `prev_hash` → `this_hash`, so a single mutation breaks the
--     chain on verify(). Tenant-visible: the owner reads their own log on
--     owner-web's Trust Center.
--
-- TENANT VISIBILITY + PLATFORM ENFORCEMENT (the dual-read design):
-- Both tables are TENANT-VISIBLE business-governance records, not opaque
-- platform metadata — the owner MUST be able to see who accessed what, when,
-- and why. So RLS exposes TWO read/write paths:
--   1. a `*_tenant_isolation` policy keyed on the canonical
--      `app.current_tenant_id` GUC — an owner-web request (bound by the
--      api-gateway database middleware) reads/writes ONLY its own tenant's
--      grants + log (consent, revoke, view);
--   2. a `*_service_role_bypass` policy — the platform break-glass middleware
--      (running under withServiceRoleContext) creates grant requests and
--      appends access-log rows across tenants.
-- The platform side may WRITE grant requests + log rows but the deny-by-default
-- enforcement lives in application code (the grant is unusable until the tenant
-- flips status to active); RLS guarantees a TENANT can never see ANOTHER
-- tenant's break-glass records.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. Every NOT NULL is
-- on a freshly-created column (no backfill hazard) so the NOT-NULL safety
-- validator passes. GUC compares are bare text (no cast), canonical name only.
--
-- Companion files:
--   * packages/database/src/schemas/operator-access.schema.ts
--   * services/api-gateway/src/break-glass/operator-access-store.ts
--   * services/api-gateway/src/middleware/break-glass.ts
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- operator_access_grants — the consent + time-box record. Default DENY:
-- a request lands `pending`; the tenant must CONSENT to flip it `active`.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS operator_access_grants (
  id                 text        NOT NULL,
  tenant_id          text        NOT NULL,
  operator_id        text        NOT NULL,
  operator_email     text,
  justification_code text        NOT NULL,
  reason             text        NOT NULL,
  scopes             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  status             text        NOT NULL DEFAULT 'pending',
  requested_at       timestamptz NOT NULL DEFAULT now(),
  consented_at       timestamptz,
  consented_by       text,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_access_grants_pkey PRIMARY KEY (id),
  CONSTRAINT operator_access_grants_status_chk
    CHECK (status IN ('pending', 'active', 'expired', 'revoked', 'denied'))
);

CREATE INDEX IF NOT EXISTS idx_operator_access_grants_tenant
  ON operator_access_grants (tenant_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_access_grants_operator
  ON operator_access_grants (operator_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_operator_access_grants_active
  ON operator_access_grants (tenant_id, operator_id, status, expires_at);

-- -----------------------------------------------------------------------------
-- operator_access_log — append-only, hash-chained Access-Transparency record.
-- One row per business-data access under an active grant. `seq` is monotonic
-- per tenant; `prev_hash` → `this_hash` chains the tenant's records so any
-- mutation breaks verify().
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS operator_access_log (
  id           text        NOT NULL,
  tenant_id    text        NOT NULL,
  grant_id     text        NOT NULL,
  operator_id  text        NOT NULL,
  seq          bigint      NOT NULL,
  route        text        NOT NULL,
  scope        text        NOT NULL,
  row_count    integer     NOT NULL DEFAULT 0,
  metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  prev_hash    text        NOT NULL,
  this_hash    text        NOT NULL,
  accessed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_access_log_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_operator_access_log_tenant_seq
  ON operator_access_log (tenant_id, seq);
CREATE INDEX IF NOT EXISTS idx_operator_access_log_grant
  ON operator_access_log (grant_id, accessed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_operator_access_log_tenant_seq
  ON operator_access_log (tenant_id, seq);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC (tenant-VISIBLE: owner-web reads
-- its own grants + log) + service-role bypass (platform break-glass middleware
-- creates requests + appends log rows) + guarded anon REVOKE. Mirrors the
-- 0309 / 0312 / 0314 shape exactly.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'operator_access_grants',
    'operator_access_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY;', tbl);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (tenant_id = current_setting(''app.current_tenant_id'', true)) '
        || 'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true));',
        tbl || '_tenant_isolation', tbl
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename  = tbl
         AND policyname = tbl || '_service_role_bypass'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        || 'USING (current_setting(''app.is_service_role'', true) = ''true'') '
        || 'WITH CHECK (current_setting(''app.is_service_role'', true) = ''true'');',
        tbl || '_service_role_bypass', tbl
      );
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END $$;

COMMIT;
