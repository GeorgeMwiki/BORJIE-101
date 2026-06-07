-- =============================================================================
-- Migration 0301 — mcp_cost_ledger (persisted MCP tool-call cost ledger).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The MCP server (`@borjie/mcp-server`) meters the USD/token cost of every
-- tool call through `CostBatcher` → `CostLedgerPort` (cost-persistence.ts). The
-- default `createInMemoryCostLedger()` keeps that ledger in a process-local
-- array that RESETS ON RESTART, so per-tenant / per-server spend is lost on
-- every deploy and is never visible across replicas. The composition root's
-- `mcp-wiring.ts` adapter forwards entries into the generic AI cost ledger
-- (`ai_cost_entries`), but that mapping is LOSSY by its own admission: it
-- collapses the MCP-native axes — `server_name`, `tool_name`, free-vs-paid,
-- tier — into a single `provider='mcp-server'` row, so "spend per MCP server"
-- and "spend per tool, per tenant" can never be reconstructed.
--
-- This migration stands up a DEDICATED, MCP-native durable ledger so:
--   * a tool-call's cost survives a restart and is shared across replicas, and
--   * aggregate spend can be sliced per (tenant, server_name) and per
--     (tenant, tool_name) — the read API the cost dashboards + budget guards
--     actually need.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors migrations 0289 / 0295):
--   tenant_id is TEXT and FK→tenants; the table FORCE-enables row-level
--   security with a tenant-isolation policy on the canonical
--   `app.current_tenant_id` GUC. Bare compare (no cast) because tenant_id is
--   already TEXT. NEVER the legacy `app.tenant_id`.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): the only money column is
--   `usd_cost` — a NUMERIC US-dollar figure. MCP provider billing is dollar-
--   denominated upstream (OpenAI / Anthropic / Deepgram all bill in USD), so
--   this is a fixed third-party unit, not a tenant-facing money render. No
--   tenant currency literal (TZS/USD/KES/…) appears in any code path that
--   reads this column.
--
-- APPEND-ONLY: this is a usage ledger — writers only ever INSERT. There is no
--   UPDATE/DELETE path in application code; aggregation is a read-time SUM.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
--   CREATE TABLE / INDEX IF NOT EXISTS + guarded DO-blocks, and a pg_roles
--   guard around the anon REVOKE. On a fully-migrated DB this is a pure no-op.
--   References only pre-existing infra (`tenants`, pgcrypto).
--
-- Companion files:
--   * packages/database/src/schemas/mcp-cost-ledger.schema.ts
--   * services/api-gateway/src/composition/mcp/persistent-mcp-cost-ledger.ts
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- mcp_cost_ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mcp_cost_ledger (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Logical MCP server the tool belongs to (e.g. 'borjie-mcp-server').
  server_name   text        NOT NULL,
  -- Dotted MCP tool id that was invoked (e.g. 'get_tenant_risk_profile').
  tool_name     text        NOT NULL,
  -- Token usage (best-effort; some providers omit one or both).
  input_tokens  integer     NOT NULL DEFAULT 0,
  output_tokens integer     NOT NULL DEFAULT 0,
  -- USD cost of this call (provider-billed dollars; see currency note above).
  usd_cost      numeric(18, 8) NOT NULL DEFAULT 0,
  -- True when the call fell under a free tier / zero-cost tool.
  was_free      boolean     NOT NULL DEFAULT false,
  -- Correlation id for the originating request (audit + tracing join key).
  request_id    text,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  -- Cost may never be negative.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_cost_ledger_usd_cost_chk'
  ) THEN
    ALTER TABLE mcp_cost_ledger
      ADD CONSTRAINT mcp_cost_ledger_usd_cost_chk
      CHECK (usd_cost >= 0);
  END IF;

  -- Token counts may never be negative.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mcp_cost_ledger_tokens_chk'
  ) THEN
    ALTER TABLE mcp_cost_ledger
      ADD CONSTRAINT mcp_cost_ledger_tokens_chk
      CHECK (input_tokens >= 0 AND output_tokens >= 0);
  END IF;
END $$;

-- Aggregate-spend read paths: per (tenant, server) and per (tenant, tool),
-- both windowed by occurred_at. Composite indexes keep the SUM scans tight.
CREATE INDEX IF NOT EXISTS idx_mcp_cost_ledger_tenant_server_occurred
  ON mcp_cost_ledger (tenant_id, server_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_cost_ledger_tenant_tool_occurred
  ON mcp_cost_ledger (tenant_id, tool_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_cost_ledger_tenant_occurred
  ON mcp_cost_ledger (tenant_id, occurred_at DESC);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC.
-- -----------------------------------------------------------------------------

ALTER TABLE mcp_cost_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_cost_ledger FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'mcp_cost_ledger'
       AND policyname = 'mcp_cost_ledger_tenant_isolation'
  ) THEN
    CREATE POLICY mcp_cost_ledger_tenant_isolation
      ON mcp_cost_ledger
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.mcp_cost_ledger FROM anon;';
  END IF;
END $$;

COMMIT;
