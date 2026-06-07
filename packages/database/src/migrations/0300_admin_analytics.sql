-- =============================================================================
-- Migration 0300 — admin analytics foundation (HQ A/B harness + product
-- activation-funnel event store + regulator audit-pack issuer).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Three internal-admin console screens (apps/admin-web/src/app/internal/
-- {ab-tests, analytics, audit-pack}) shipped as honest, stub-disclosed
-- fixtures because they had no feeding system. This migration stands up the
-- REAL tables so each screen renders live data and its actions actually do
-- something:
--
--   * ab_experiments      — HQ A/B harness. One row per prompt/model variant
--                           trialled for a junior against the golden set +
--                           canary tenants. PLATFORM-scoped (Borjie HQ runs
--                           experiments across the fleet), so `tenant_id` is
--                           NULLABLE and there is NO RLS tenant policy — access
--                           is gated at the route layer (SUPER_ADMIN / ADMIN).
--
--   * activation_events   — the product activation/onboarding FUNNEL event log.
--                           One append-only row per real product milestone
--                           (signup, licence created, first sale/royalty,
--                           onboarding complete, …). TENANT-SCOPED: this is the
--                           canonical "what did this tenant do, when" stream the
--                           funnel + cohort aggregates read. FORCE RLS on the
--                           canonical `app.current_tenant_id` GUC.
--
--   * audit_packs         — regulator audit-pack issuer. One row per minted pack
--                           (TMAA / NEMC / BoT review bundle) with an expiring
--                           signed URL. TENANT-SCOPED (a pack belongs to the
--                           tenant whose evidence it bundles); HQ operators read
--                           cross-tenant via a service-role/elevated context, so
--                           the table FORCE-enables RLS on the canonical GUC and
--                           HQ list reads run outside a single tenant context.
--
-- PLATFORM vs TENANT SCOPE (CLAUDE.md hard rule). `activation_events` and
-- `audit_packs` are tenant-scoped → tenant_id TEXT NOT NULL, FK→tenants, FORCE
-- ROW LEVEL SECURITY + a policy on the canonical `app.current_tenant_id` GUC
-- (bare TEXT compare; tenant_id is already TEXT; NEVER the legacy
-- app.tenant_id). `ab_experiments` is platform/HQ infrastructure (an experiment
-- spans many tenants) → tenant_id is NULLABLE and the table is deliberately
-- left WITHOUT a tenant RLS policy; the only callers are the SUPER_ADMIN /
-- ADMIN-gated internal routes. This mirrors the platform-scoped posture of
-- feature_flags / tenants in the existing internal surfaces.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): there are NO money columns here.
-- Any monetary fact a funnel event references lives inside the free-form
-- `props` jsonb exactly as the caller handed it (minor-units + ISO-4217
-- currency code), never a typed money column and never a currency literal.
--
-- APPEND-ONLY DISCIPLINE: activation_events is an event log. The
-- recordActivationEvent helper only ever INSERTs; rows are never updated or
-- deleted in the product path.
--
-- ID DISCIPLINE: every `id` is a uuid with a `gen_random_uuid()` default
-- (pgcrypto) — these tables have no external string-id port to mirror.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule: migrations are immutable
-- + forward-only). Every object uses CREATE TABLE IF NOT EXISTS / guarded
-- DO-blocks (pg_policies / pg_constraint checks) / CREATE INDEX IF NOT EXISTS,
-- and a pg_roles guard around the anon REVOKE. On a fully-migrated DB this is a
-- pure no-op. References only pre-existing infra (`tenants`, pgcrypto).
--
-- Companion files:
--   * packages/database/src/schemas/admin-analytics.schema.ts
--   * services/api-gateway/src/services/activation-events/record-activation-event.ts
--   * services/api-gateway/src/routes/mining/internal/analytics.hono.ts
--   * services/api-gateway/src/routes/mining/internal/ab-tests.hono.ts
--   * services/api-gateway/src/routes/mining/internal/audit-pack.hono.ts
-- Down: packages/database/src/migrations/down/0300_down_admin_analytics.sql
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- ab_experiments — HQ A/B harness (PLATFORM-scoped; tenant_id NULLABLE).
-- One row per variant trialled for a junior against the golden set + canaries.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ab_experiments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = fleet-wide experiment (the common case). A non-NULL tenant_id pins
  -- the experiment to a single tenant's traffic. FK is intentionally OMITTED so
  -- this platform table never blocks on tenant lifecycle; the route validates.
  tenant_id       text,
  -- Human-readable description of the contrast, e.g. "geology v18-rc vs v17".
  variant         text        NOT NULL,
  -- Which junior the variant targets (geology|sales|compliance|fx|...).
  junior          text        NOT NULL,
  -- Golden-set score in [0,1] for the candidate variant (NULL until scored).
  golden_score    double precision,
  -- Canary tenant ids the variant is live for (free-text refs into tenants).
  canary_tenants  text[]      NOT NULL DEFAULT '{}',
  -- running|won|lost|promoted|archived.
  status          text        NOT NULL DEFAULT 'running',
  notes           text,
  created_by      text,
  -- Set when a winner is promoted via POST /:id/promote-winner.
  promoted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ab_experiments_status_chk'
  ) THEN
    ALTER TABLE ab_experiments
      ADD CONSTRAINT ab_experiments_status_chk
      CHECK (status IN ('running', 'won', 'lost', 'promoted', 'archived'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ab_experiments_status_idx
  ON ab_experiments (status);

CREATE INDEX IF NOT EXISTS ab_experiments_junior_idx
  ON ab_experiments (junior);

CREATE INDEX IF NOT EXISTS ab_experiments_created_idx
  ON ab_experiments (created_at);

-- -----------------------------------------------------------------------------
-- activation_events — product activation/onboarding FUNNEL event log.
-- Append-only; TENANT-SCOPED. The funnel + cohort aggregates read this.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS activation_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The milestone slug, e.g. signup_completed | licence_created |
  -- first_sale_recorded | first_royalty_paid | onboarding_completed.
  event_type   text        NOT NULL,
  -- The user/actor who triggered the milestone (NULL for system-emitted).
  actor_id     text,
  -- Free-form milestone payload. Any monetary fact lives here as
  -- minor-units + ISO-4217 currency code — NEVER a typed money column.
  props        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activation_events_tenant_idx
  ON activation_events (tenant_id);

CREATE INDEX IF NOT EXISTS activation_events_tenant_type_idx
  ON activation_events (tenant_id, event_type);

CREATE INDEX IF NOT EXISTS activation_events_type_occurred_idx
  ON activation_events (event_type, occurred_at);

CREATE INDEX IF NOT EXISTS activation_events_tenant_occurred_idx
  ON activation_events (tenant_id, occurred_at);

-- -----------------------------------------------------------------------------
-- audit_packs — regulator audit-pack issuer. One row per minted pack.
-- TENANT-SCOPED. signed_url is NULL until the storage presign succeeds
-- (status 'pending'); we NEVER fabricate a URL.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_packs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Regulator / purpose, e.g. "TMAA Q2 audit" | "NEMC site inspection".
  regulator   text        NOT NULL,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  -- Wall-clock expiry of the signed URL (NULL until a URL is minted).
  expires_at  timestamptz,
  -- Presigned download URL. NULL while status='pending' — never fabricated.
  signed_url  text,
  -- pending|ready|expired|revoked.
  status      text        NOT NULL DEFAULT 'pending',
  -- Free-form bundle metadata (object key, byte count, evidence counts, …).
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_packs_status_chk'
  ) THEN
    ALTER TABLE audit_packs
      ADD CONSTRAINT audit_packs_status_chk
      CHECK (status IN ('pending', 'ready', 'expired', 'revoked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_packs_tenant_idx
  ON audit_packs (tenant_id);

CREATE INDEX IF NOT EXISTS audit_packs_tenant_issued_idx
  ON audit_packs (tenant_id, issued_at);

CREATE INDEX IF NOT EXISTS audit_packs_status_idx
  ON audit_packs (status);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC for the two tenant-scoped tables
-- (FORCE so the owner role cannot bypass it either). ab_experiments is
-- platform/HQ infra and intentionally carries NO tenant policy.
-- -----------------------------------------------------------------------------

ALTER TABLE activation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE activation_events FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_packs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_packs       FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'activation_events'
       AND policyname = 'activation_events_tenant_isolation'
  ) THEN
    CREATE POLICY activation_events_tenant_isolation
      ON activation_events
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'audit_packs'
       AND policyname = 'audit_packs_tenant_isolation'
  ) THEN
    CREATE POLICY audit_packs_tenant_isolation
      ON audit_packs
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- ab_experiments has no tenant RLS, so anon must be revoked there explicitly
-- to avoid any anon read of platform experiment data.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.ab_experiments FROM anon;';
    EXECUTE 'REVOKE ALL ON public.activation_events FROM anon;';
    EXECUTE 'REVOKE ALL ON public.audit_packs FROM anon;';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOWN (commented — dev/staging only; reverse order, FK-safe).
-- Canonical reversible script: down/0300_down_admin_analytics.sql.
-- Dropping these tables DISCARDS every A/B experiment, the entire product
-- activation-funnel event history, and every minted regulator audit-pack.
-- A production rollback must export all three first if any history is retained.
--
-- BEGIN;
--
-- DROP POLICY IF EXISTS audit_packs_tenant_isolation       ON audit_packs;
-- DROP POLICY IF EXISTS activation_events_tenant_isolation ON activation_events;
--
-- DROP INDEX IF EXISTS audit_packs_status_idx;
-- DROP INDEX IF EXISTS audit_packs_tenant_issued_idx;
-- DROP INDEX IF EXISTS audit_packs_tenant_idx;
-- DROP INDEX IF EXISTS activation_events_tenant_occurred_idx;
-- DROP INDEX IF EXISTS activation_events_type_occurred_idx;
-- DROP INDEX IF EXISTS activation_events_tenant_type_idx;
-- DROP INDEX IF EXISTS activation_events_tenant_idx;
-- DROP INDEX IF EXISTS ab_experiments_created_idx;
-- DROP INDEX IF EXISTS ab_experiments_junior_idx;
-- DROP INDEX IF EXISTS ab_experiments_status_idx;
--
-- DROP TABLE IF EXISTS audit_packs;
-- DROP TABLE IF EXISTS activation_events;
-- DROP TABLE IF EXISTS ab_experiments;
--
-- COMMIT;
-- =============================================================================
