-- =============================================================================
-- Migration 0309 — cognitive_memory_audit_chain (hash-chained, append-only).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The Wave-2 cognitive-persistence work added `createDrizzleAuditChain`
-- (packages/cognitive-memory) + the `cognitiveMemoryAuditChain` Drizzle table
-- def (packages/database/src/schemas/cognitive-memory.schema.ts) so the
-- cognitive-memory audit chain SURVIVES a process restart — but it shipped the
-- pgTable WITHOUT a CREATE migration. The schema→migration coverage gate
-- (scripts/check-schema-migration-coverage.mjs) flagged it as the one
-- uncovered table: on a freshly-migrated DB the durable audit chain would throw
-- `relation "cognitive_memory_audit_chain" does not exist`. This migration
-- closes that drift.
--
-- One row per memory mutation (observe / reinforce / cite / contradict /
-- promote / decay). Tamper-evident per tenant: each row carries its zero-based
-- `chain_index`, the previous row's `row_hash` (or 'GENESIS' for the first),
-- and its own `row_hash` = sha256/hmac(canonicalJson({ prev, payload,
-- secretId? })) computed by @borjie/audit-hash-chain. APPEND-ONLY — never
-- update or delete a row (doing so breaks verifyChain); the unique
-- (tenant_id, chain_index) index enforces the contiguous single chain.
--
-- TENANT SCOPE (CLAUDE.md hard rule): tenant_id is TEXT (matching the
-- cognitive_memory_cells family, migration 0029 — no FK, same as its siblings);
-- the table FORCE-enables RLS with a tenant-isolation policy on the canonical
-- `app.current_tenant_id` GUC (bare compare, no cast; NEVER the legacy
-- `app.tenant_id`). A service-role bypass mirrors the 0308 shape so the
-- composition root's system reads (withServiceRoleContext) are permitted.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): every object uses
-- CREATE ... IF NOT EXISTS + guarded DO-blocks + a pg_roles guard around the
-- anon REVOKE. On a fully-migrated DB this is a pure no-op. All NOT NULLs are
-- on freshly-created columns (no backfill hazard).
--
-- Companion files:
--   * packages/database/src/schemas/cognitive-memory.schema.ts
--   * packages/cognitive-memory/src/audit/drizzle-audit-chain.ts
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS cognitive_memory_audit_chain (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      text        NOT NULL,
  -- Zero-based, contiguous position within this tenant's chain.
  chain_index    integer     NOT NULL,
  -- Preceding row's row_hash, or 'GENESIS' for the first row.
  prev_hash      text        NOT NULL,
  -- sha256/hmac of canonicalJson({ prev, payload, secretId? }).
  row_hash       text        NOT NULL,
  -- memory.observe | memory.reinforce | memory.cite | memory.contradict |
  -- memory.promote | memory.decay.
  event_kind     text        NOT NULL,
  cell_id        text        NOT NULL,
  specialisation text        NOT NULL,
  turn_id        text        NOT NULL,
  -- Wall-clock for the underlying event.
  occurred_at    timestamptz NOT NULL,
  -- Opaque extra payload fields folded into the row hash.
  extra          jsonb,
  -- HMAC secret id used at sealing time (rotation aware).
  secret_id      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Append-only contiguous chain: exactly one row per (tenant_id, chain_index).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cmac_tenant_chain_index
  ON cognitive_memory_audit_chain (tenant_id, chain_index);

-- Chain walk (verifyChain reads a tenant's rows in chain order).
CREATE INDEX IF NOT EXISTS idx_cmac_tenant_chain
  ON cognitive_memory_audit_chain (tenant_id, chain_index);
-- Per-cell provenance lookup.
CREATE INDEX IF NOT EXISTS idx_cmac_cell
  ON cognitive_memory_audit_chain (cell_id, occurred_at);

-- -----------------------------------------------------------------------------
-- RLS — tenant isolation on the canonical GUC.
-- -----------------------------------------------------------------------------

ALTER TABLE cognitive_memory_audit_chain ENABLE ROW LEVEL SECURITY;
ALTER TABLE cognitive_memory_audit_chain FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'cognitive_memory_audit_chain'
       AND policyname = 'cognitive_memory_audit_chain_tenant_isolation'
  ) THEN
    CREATE POLICY cognitive_memory_audit_chain_tenant_isolation
      ON cognitive_memory_audit_chain
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'cognitive_memory_audit_chain'
       AND policyname = 'cognitive_memory_audit_chain_service_role_bypass'
  ) THEN
    CREATE POLICY cognitive_memory_audit_chain_service_role_bypass
      ON cognitive_memory_audit_chain
      FOR ALL
      USING (current_setting('app.is_service_role', true) = 'true')
      WITH CHECK (current_setting('app.is_service_role', true) = 'true');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.cognitive_memory_audit_chain FROM anon;';
  END IF;
END $$;

COMMIT;
