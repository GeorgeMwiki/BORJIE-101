-- =============================================================================
-- Migration 0159 — Royalty-return DRAFTS (the backing table for the
--                   confirm-required, NON-MONEY `draft_royalty_return` verb)
--
-- WHY THIS TABLE EXISTS
-- ---------------------
-- `draft_royalty_return` is the royalty sibling of `draft_payroll_run`: a
-- CONFIRM-REQUIRED chat verb that creates a NON-BINDING `status='draft'`
-- royalty-return header the owner reviews + completes in the royalty surface
-- (apps/owner-web RoyaltyDraftPanel). It was previously FLAGGED "no backing
-- table" in services/api-gateway/.../action-executor/registry.ts and was
-- correctly NOT built. This migration lands the table so the verb can ship.
--
-- HARD MONEY BOUNDARY (CLAUDE.md)
-- -------------------------------
-- This table carries NO posted money / ledger column. There is deliberately
-- NO gross_value, NO royalty_amount, and NO ledger_txn_id here. The royalty
-- FIGURES (gross value, royalty rate, royalty amount) are filled by the owner
-- in the royalty surface — NEVER from chat — and the actual royalty PAYMENT
-- still posts the money path through `LedgerService.post()` on a SEPARATE,
-- four-eye-gated owner flow (the DEFERRED `file_royalty` verb), never here.
-- A `draft` row is a non-binding pointer the owner approves elsewhere; the AI
-- writes ONLY the period + mineral + (optional, non-money) quantity/unit and
-- stops at `status='draft'` — the pre-money state. Mirrors how
-- `draft_payroll_run` stops at the `payroll_runs` draft header (0134 §4) with
-- its money columns left at their DB defaults.
--
-- Forward-only. Append-only per CLAUDE.md "Migrations are immutable".
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
--
-- Tenant scope:
--   RLS FORCE enabled per CLAUDE.md hard rule, mirroring `payroll_runs`
--   (0134 §4) EXACTLY: the `app.current_tenant_id` GUC is bound by
--   api-gateway databaseMiddleware (and the chat confirm-action transaction).
--   Never disable RLS or double-filter from app code.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — royalty_return_drafts
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS royalty_return_drafts (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text          NOT NULL,
  created_by_user_id  text          NOT NULL,
  period_start        date          NOT NULL,
  period_end          date          NOT NULL,
  -- ISO mineral code or named gem (Au|Cu|tanzanite|...). The royalty return
  -- is filed per-mineral, so it is part of the natural key below.
  mineral             text          NOT NULL,
  -- Optional, NON-MONEY production quantity the draft scopes (e.g. mass).
  -- NULL until the owner fills it; this is a physical figure, NOT money.
  quantity            numeric(18,4),
  -- Unit for `quantity` (kg | t | g | ct | ...). NULL when quantity is NULL.
  unit                text,
  -- draft -> (owner completes + files elsewhere). Pre-money state only.
  status              text          NOT NULL DEFAULT 'draft',
  -- Free-form provenance / chat intent bag. NO money figure is stored here.
  notes               jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT royalty_return_drafts_status_chk CHECK (
    status IN ('draft', 'pending_approval', 'submitted', 'cancelled')
  ),
  CONSTRAINT royalty_return_drafts_period_chk CHECK (period_end >= period_start),
  -- A physical quantity can never be negative (it is NOT money, but still
  -- a real-world measure that must be non-negative when supplied).
  CONSTRAINT royalty_return_drafts_qty_nonneg_chk CHECK (
    quantity IS NULL OR quantity >= 0
  ),
  -- Idempotency: one draft per tenant per (period_start, period_end, mineral).
  -- A repeated chat draft for the same period + mineral returns the existing
  -- row instead of inserting a duplicate (mirrors payroll_runs' uniqueness).
  CONSTRAINT royalty_return_drafts_unique_tenant_period_mineral UNIQUE (
    tenant_id, period_start, period_end, mineral
  )
);

CREATE INDEX IF NOT EXISTS idx_royalty_return_drafts_tenant_status_created
  ON royalty_return_drafts (tenant_id, status, created_at DESC);

-- RLS FORCE — mirrors payroll_runs (0134 §4) EXACTLY.
ALTER TABLE royalty_return_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE royalty_return_drafts FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'royalty_return_drafts'
       AND policyname = 'royalty_return_drafts_tenant_isolation'
  ) THEN
    CREATE POLICY royalty_return_drafts_tenant_isolation
      ON royalty_return_drafts
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMENT ON TABLE royalty_return_drafts IS
  'Royalty-return DRAFT header — the backing table for the confirm-required, '
  'NON-MONEY draft_royalty_return chat verb (sibling of draft_payroll_run / '
  'payroll_runs draft, 0134 §4). NO posted money / ledger column by design: '
  'gross_value / royalty_amount are filled by the owner in the royalty '
  'surface, NEVER from chat, and the royalty PAYMENT posts via '
  'LedgerService.post() on a separate four-eye flow (CLAUDE.md hard rule).';

COMMIT;
