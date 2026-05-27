-- =============================================================================
-- Migration 0079 — Owner Brief Snapshots (Wave OWNER-HOME)
--
-- Companion to:
--   - services/api-gateway/src/routes/owner/brief.hono.ts
--   - services/consolidation-worker/src/tasks/owner-brief-cron.ts
--   - Docs/research/owner-status-sota.md
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- One table:
--
--   owner_brief_snapshots — one row per (tenant_id, snapshot_date). Caches
--                           the composed 7-slot owner home brief produced
--                           by the 06:00 EAT cron (and on-demand fallback).
--                           The brief is JSONB so the seven slots
--                           (daily-brief, decisions, cash-runway,
--                           production-vs-target, 27-mar-cliff,
--                           open-high-incidents, licence-health) can
--                           evolve without a migration churn.
--                           hash_chain_id links each snapshot to the
--                           ai_audit_chain entry that recorded its
--                           composition for forensic replay.
--
-- Tenant-scoped via the canonical `current_setting('app.tenant_id', true)`
-- GUC RLS pattern from migration 0003 (re-used throughout the codebase).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- owner_brief_snapshots — cached 7-slot owner home brief, one per day
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS owner_brief_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  /** Calendar date (EAT) the snapshot represents. Unique with tenant_id. */
  snapshot_date   date        NOT NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  /** Full composed brief — keys: dailyBrief, decisions, cashRunway,
      productionVsTarget, cliffStatus, openHighIncidents, licenceHealth. */
  brief           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** Provenance — either the 06:00 EAT cron or the on-demand BFF fallback. */
  source          text        NOT NULL DEFAULT 'cron',
  /** FK-soft link to ai_audit_chain.id — the audit row that hash-chained
      this snapshot's composition. NULL when the audit append failed (we
      still persist the snapshot; the audit gap is logged + observable). */
  hash_chain_id   uuid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'obs_source_chk'
  ) THEN
    ALTER TABLE owner_brief_snapshots
      ADD CONSTRAINT obs_source_chk
      CHECK (source IN ('cron', 'on-demand'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'obs_tenant_date_uniq'
  ) THEN
    ALTER TABLE owner_brief_snapshots
      ADD CONSTRAINT obs_tenant_date_uniq
      UNIQUE (tenant_id, snapshot_date);
  END IF;
END $$;

-- Hot path: load latest snapshot for a tenant (BFF cache read).
CREATE INDEX IF NOT EXISTS idx_obs_tenant_date_desc
  ON owner_brief_snapshots (tenant_id, snapshot_date DESC);

-- Audit-chain reverse-lookup (forensic verify of a single snapshot).
CREATE INDEX IF NOT EXISTS idx_obs_hash_chain
  ON owner_brief_snapshots (hash_chain_id)
  WHERE hash_chain_id IS NOT NULL;

ALTER TABLE owner_brief_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE owner_brief_snapshots FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'owner_brief_snapshots'
       AND policyname = 'obs_tenant_isolation'
  ) THEN
    CREATE POLICY obs_tenant_isolation
      ON owner_brief_snapshots
      FOR ALL
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
