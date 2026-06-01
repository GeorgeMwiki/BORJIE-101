-- =============================================================================
-- Migration 0162 — journal_idempotency: post-once dedupe for LedgerService.post()
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The ledger durability work (defect #2: replay-safety) makes
-- `LedgerService.postJournalEntry(request, { idempotencyKey })` idempotent: a
-- retried post with the same key returns the EXISTING journal instead of
-- double-posting. That dedupe is keyed at the JOURNAL grain — one idempotency
-- key maps to one balanced journal (which is N ledger_entries posted together).
--
-- The payments-ledger repository
-- (services/payments-ledger/src/repositories/drizzle-ledger-entry.repository.ts)
-- reads + writes a `journal_idempotency` table for this, declared locally there
-- (tsc-self-contained) and FLAGGED for this database package to materialise.
-- This migration creates the physical table + the mandatory tenant RLS.
--
-- WHY A SEPARATE TABLE (not ledger_entries.idempotency_key)
-- ---------------------------------------------------------
-- Idempotency is per-POST, not per-ENTRY. A balanced journal shares ONE
-- idempotency key across its N entries, so a UNIQUE(tenant_id, idempotency_key)
-- on ledger_entries would reject the 2nd..Nth entry of a single journal. The
-- correct grain is one row per (tenant, key) -> journal_id, which is exactly
-- this table's composite primary key. (0160's now-unused ledger_entries
-- idempotency column is retired separately.)
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (mirrors 0157/0160's
--     CORRECT GUC; never the legacy app.tenant_id). REVOKE anon.
--   * No money columns here — this is a dedupe index only.
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard. Safe
-- to re-run. Append-only per CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — journal_idempotency
--
-- Composite PK (tenant_id, idempotency_key) supplies the UNIQUE guarantee the
-- duplicate-detection relies on. journal_id points back at the single journal a
-- replayed post resolves to. Column layout is byte-for-byte the payments-ledger
-- service's local Drizzle declaration.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS journal_idempotency (
  tenant_id        TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  journal_id       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, idempotency_key)
);

-- Reverse lookup: "which idempotency key minted this journal?" (ops / audit).
CREATE INDEX IF NOT EXISTS journal_idempotency_journal_idx
  ON journal_idempotency(journal_id);

-- -----------------------------------------------------------------------------
-- §2 — FORCE RLS + tenant-isolation policy.
--
-- Mirrors 0160 §4: current_setting('app.current_tenant_id', true). tenant_id is
-- TEXT so the compare is bare. FOR ALL covers the repository's INSERT + the
-- duplicate SELECT. Idempotent: ENABLE/FORCE are no-ops if already set; policy
-- guarded by a pg_policies existence check.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'journal_idempotency'
  ) THEN
    EXECUTE 'ALTER TABLE public.journal_idempotency ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.journal_idempotency FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'journal_idempotency'
        AND policyname = 'journal_idempotency_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY journal_idempotency_tenant_isolation ON public.journal_idempotency
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    -- anon role is a Supabase construct; guard so the migration still applies
    -- on a vanilla Postgres (CI empty-PG check / non-Supabase env).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.journal_idempotency FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE journal_idempotency IS
  'Post-once dedupe for LedgerService.post(): (tenant_id, idempotency_key) -> '
  'journal_id. A retried post with a seen key returns the existing journal '
  'instead of double-posting. Per-journal grain (NOT per-entry). RLS FORCE on '
  'app.current_tenant_id. Added in 0162.';

COMMIT;
