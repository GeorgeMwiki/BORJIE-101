-- =============================================================================
-- Migration 0315 — RLS tenant_id access-path indexes (INDEX-ONLY).
--
-- WHY THIS MIGRATION EXISTS (RSS-03/RSS-04 hot-path protection)
-- ------------------------------------------------------------
-- Every tenant-scoped table carries a FORCE-RLS policy of the shape
--   USING (tenant_id = current_setting('app.current_tenant_id', true))
-- When the gateway runs in DATABASE_POOL_MODE=transaction, that predicate is
-- evaluated on the SET-LOCAL hot path for EVERY query. Without a leading
-- `(tenant_id)` index the planner falls back to a sequential scan on the
-- tenant predicate, which collapses p99 under scale. This migration adds the
-- missing leading-`tenant_id` btree index to the hot tenant-scoped tables so
-- the RLS predicate resolves via an index scan.
--
-- THIS CANNOT WEAKEN ISOLATION
-- ----------------------------
-- It is PURELY an access-path change: no policy is touched, no table is
-- altered, no column is added, no WITH CHECK changes. An index cannot alter
-- row visibility — it only changes how the planner reaches the rows the policy
-- already permits. There is therefore NO RLS/FORCE/GUC/REVOKE change here; the
-- canonical app.current_tenant_id GUC and service_role_bypass policies are
-- owned by the migrations that created each table and are left untouched.
--
-- TRANSACTION-SAFE — plain CREATE INDEX, NOT CONCURRENTLY
-- ------------------------------------------------------
-- The Borjie migration runner wraps EACH migration file in a single
-- transaction (run-migrations.ts). `CREATE INDEX CONCURRENTLY` cannot run
-- inside a transaction block, so this migration deliberately uses plain
-- `CREATE INDEX IF NOT EXISTS` (transaction-safe). On the hot tables this
-- takes a brief ACCESS EXCLUSIVE lock; the tables are append-mostly and the
-- index build is fast, so the lock window is short. (A future op that needs a
-- zero-lock build on a very large table can DROP + rebuild CONCURRENTLY out of
-- band — that is an ops runbook step, not a schema migration.)
--
-- IDEMPOTENT / FRESH-DB SAFE / DRIFT-SAFE (CLAUDE.md hard rail)
-- ------------------------------------------------------------
-- The repo is known to carry schema-ahead-of-migrations drift (some hot tables
-- exist on some DBs and not others). A bare `CREATE INDEX IF NOT EXISTS` only
-- guards a missing INDEX, not a missing TABLE/COLUMN — it would ERROR if the
-- target table or `tenant_id` column is absent. So each index is created from
-- inside a single DO block that FIRST checks information_schema for the table
-- AND a `tenant_id` column, and only then issues the CREATE. Net effect:
--   * table+column present, index absent  -> index created
--   * index already present               -> no-op (IF NOT EXISTS)
--   * table or column absent              -> silently skipped (no error)
-- Re-running the whole migration is a pure no-op. No data is touched.
--
-- NOT-NULL SAFETY: this migration adds ZERO columns and ZERO NOT NULL
-- constraints, so scripts/validate-migration-safety.mjs passes trivially.
--
-- Companion: down/0315_down_rls_tenant_id_indexes.sql (dev/staging only).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  t text;
  -- Hot tenant-scoped tables whose RLS USING predicate filters on tenant_id.
  -- Curated from the ledger / marketplace-bids / buyer-KYC / threads / corpus /
  -- notifications / audit-chain / agent-memory hot paths. Any name absent on a
  -- given DB is skipped by the information_schema guard below.
  hot_tables text[] := ARRAY[
    -- double-entry ledger (money path read hot)
    'ledger_entries',
    -- marketplace / bids / offtake
    'marketplace_bids',
    'marketplace_listings',
    'junior_marketplace_listings',
    'bid_negotiations',
    'bid_messages',
    'request_for_bids',
    'request_for_bid_responses',
    'offtake_queue',
    -- buyer / procurement KYC
    'buyer_kyc_records',
    'procurement_kyc_documents',
    -- notifications fan-out
    'buyer_notifications',
    'notifications_outbox',
    'notification_dispatch_log',
    -- brain threads / corpus / memory / audit (read hot per turn)
    'threads',
    'intelligence_corpus_chunks',
    'agent_memory',
    'ai_audit_chain'
  ];
BEGIN
  FOREACH t IN ARRAY hot_tables
  LOOP
    -- Only act when BOTH the table and a `tenant_id` column exist on this DB.
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'tenant_id'
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id);',
        'idx_' || t || '_tenant_id',
        t
      );
    END IF;
  END LOOP;
END$$;

COMMIT;

-- =============================================================================
-- End of migration 0315_rls_tenant_id_indexes.sql
-- =============================================================================
