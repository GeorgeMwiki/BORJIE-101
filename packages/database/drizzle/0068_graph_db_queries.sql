-- =============================================================================
-- Migration 0068 — graph_db_queries (SOTA-Graph-DB Wave)
--
-- Companion to Docs/DESIGN/GRAPH_DATABASE_SOTA_2026.md.
--
-- `@borjie/graph-database` issues Cypher statements against three drivers
-- (Neo4j 5 primary, FalkorDB fast-in-memory, Apache AGE Postgres-co-located).
-- Every issued query is logged into `graph_db_queries` so:
--   - the audit-hash chain is per-tenant verifiable end-to-end;
--   - latency budgets stay observable per driver;
--   - forensic replay can reconstruct a tenant's graph-write history.
--
-- One table:
--
--   graph_db_queries — tenant-scoped, immutable audit row for every
--                      Cypher statement issued via the graph-database
--                      driver registry. Hash-chained against the
--                      prior row in the tenant's chain.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration 0003.
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- graph_db_queries — append-only audit trail of issued Cypher statements
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS graph_db_queries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL,
  /** Driver that ran the statement: neo4j | falkordb | apache_age. */
  driver           text NOT NULL,
  /** The exact Cypher string sent to the driver (post tenant-scoping). */
  query_cypher     text NOT NULL,
  /** Parameter map (always parameterised — never string-interp). */
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Wall-clock latency from issue to result. */
  latency_ms       integer NOT NULL DEFAULT 0,
  ran_at           timestamptz NOT NULL DEFAULT now(),
  /** Hash of the prior graph_db_queries row in this tenant's chain.
      Empty string for the genesis row. */
  prev_hash        text NOT NULL DEFAULT '',
  audit_hash       text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'graph_db_queries_driver_chk'
  ) THEN
    ALTER TABLE graph_db_queries
      ADD CONSTRAINT graph_db_queries_driver_chk
      CHECK (driver IN ('neo4j','falkordb','apache_age'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'graph_db_queries_cypher_nonempty_chk'
  ) THEN
    ALTER TABLE graph_db_queries
      ADD CONSTRAINT graph_db_queries_cypher_nonempty_chk
      CHECK (length(query_cypher) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'graph_db_queries_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE graph_db_queries
      ADD CONSTRAINT graph_db_queries_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'graph_db_queries_latency_nonneg_chk'
  ) THEN
    ALTER TABLE graph_db_queries
      ADD CONSTRAINT graph_db_queries_latency_nonneg_chk
      CHECK (latency_ms >= 0);
  END IF;
END $$;

-- Hot path: tenant audit by ran_at descending (most recent first).
CREATE INDEX IF NOT EXISTS idx_graph_db_queries_tenant_ran_at
  ON graph_db_queries (tenant_id, ran_at DESC);

-- Hot path: per-driver latency analytics.
CREATE INDEX IF NOT EXISTS idx_graph_db_queries_tenant_driver_ran_at
  ON graph_db_queries (tenant_id, driver, ran_at DESC);

-- Forensic replay lookup by audit hash.
CREATE INDEX IF NOT EXISTS idx_graph_db_queries_audit_hash
  ON graph_db_queries (audit_hash);

ALTER TABLE graph_db_queries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'graph_db_queries'
       AND policyname = 'graph_db_queries_tenant_isolation'
  ) THEN
    CREATE POLICY graph_db_queries_tenant_isolation
      ON graph_db_queries
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
