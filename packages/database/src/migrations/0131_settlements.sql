-- =============================================================================
-- Migration 0131 — Commercial chain closure: settlements + task RFB link
--
-- Closes the buyer -> owner -> manager -> worker -> buyer commercial loop:
--
--   1. Adds `kind` + `parent_rfb_id` columns to `mining_tasks` so the
--      owner-web dispatch CTA can create a task tagged `rfb_fulfill`
--      that the worker fulfilment flow can join back to the originating
--      buyer RFB without a separate join table.
--
--   2. Adds `settlements` — one row per CoC final-step signature.
--      Computes gross / royalty / fee / net + records the
--      double-entry ledger transaction id (CLAUDE.md hard rule: money
--      MUST go through LedgerService.post()) + the payout provider ref
--      (M-Pesa B2C, wallet credit, future Stripe). Tenant-scoped via
--      RLS FORCE.
--
-- Forward-only. Append-only per CLAUDE.md "Migrations are immutable".
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — mining_tasks: kind + parent_rfb_id
-- -----------------------------------------------------------------------------

ALTER TABLE mining_tasks
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS parent_rfb_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_tasks_kind_chk'
  ) THEN
    ALTER TABLE mining_tasks
      ADD CONSTRAINT mining_tasks_kind_chk
      CHECK (kind IN ('standard', 'rfb_fulfill', 'inspection', 'maintenance'));
  END IF;

  -- parent_rfb_id is REQUIRED when kind='rfb_fulfill', NULL otherwise.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'mining_tasks_parent_rfb_kind_chk'
  ) THEN
    ALTER TABLE mining_tasks
      ADD CONSTRAINT mining_tasks_parent_rfb_kind_chk
      CHECK (
        (kind = 'rfb_fulfill' AND parent_rfb_id IS NOT NULL)
        OR (kind <> 'rfb_fulfill')
      );
  END IF;
END $$;

-- Hot path: when an RFB is fulfilled we look up "all tasks for this RFB"
-- so the buyer-notification + settlement orchestrators can find them.
CREATE INDEX IF NOT EXISTS idx_mining_tasks_tenant_parent_rfb
  ON mining_tasks (tenant_id, parent_rfb_id)
  WHERE parent_rfb_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- §2 — settlements
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS settlements (
  id                       uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid          NOT NULL,
  rfb_id                   uuid          NOT NULL,
  response_id              uuid          NOT NULL,
  -- Gross = offered_tonnage * offered_price_tzs. royalty (TZ default 7% gold),
  -- platform fee (1.5%), net = gross - royalty - fee. All TZS, numeric(15,2)
  -- to match the request_for_bid_responses + ledger schema.
  gross_tzs                numeric(15,2) NOT NULL,
  royalty_tzs              numeric(15,2) NOT NULL,
  fee_tzs                  numeric(15,2) NOT NULL,
  net_tzs                  numeric(15,2) NOT NULL,
  status                   text          NOT NULL DEFAULT 'pending',
  -- Ledger journal id from LedgerService.post(). NULL until the ledger
  -- write lands; orchestrator stamps post-CAS.
  ledger_txn_id            text,
  -- M-Pesa B2C | wallet | stripe (future). NULL until payout fires.
  payout_provider          text,
  payout_provider_ref      text,
  -- Idempotency key on coCStepChecksum so a replay of the buyer's
  -- sign-delivery doesn't double-settle the response.
  idempotency_key          text          NOT NULL,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  completed_at             timestamptz,

  CONSTRAINT settlements_status_chk CHECK (
    status IN ('pending', 'posted', 'paying_out', 'completed', 'failed')
  ),
  CONSTRAINT settlements_gross_positive_chk CHECK (gross_tzs > 0),
  CONSTRAINT settlements_royalty_nonneg_chk CHECK (royalty_tzs >= 0),
  CONSTRAINT settlements_fee_nonneg_chk CHECK (fee_tzs >= 0),
  CONSTRAINT settlements_net_positive_chk CHECK (net_tzs > 0),
  -- net = gross - royalty - fee (sanity-check the math on insert).
  CONSTRAINT settlements_math_chk CHECK (
    net_tzs = gross_tzs - royalty_tzs - fee_tzs
  ),
  -- One settlement per (tenant, response, idempotency-key). Replays hit
  -- the dup and short-circuit.
  CONSTRAINT settlements_unique_response_idem UNIQUE (
    tenant_id, response_id, idempotency_key
  )
);

-- Hot paths:
--   * owner.settlement.list_mine  -- tenant + created_at DESC.
--   * buyer notification cross-ref -- (tenant_id, rfb_id).
--   * background payout retry      -- status='paying_out'.
CREATE INDEX IF NOT EXISTS idx_settlements_tenant_created
  ON settlements (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlements_tenant_rfb
  ON settlements (tenant_id, rfb_id);

CREATE INDEX IF NOT EXISTS idx_settlements_status_paying_out
  ON settlements (status)
  WHERE status = 'paying_out';

ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'settlements'
       AND policyname = 'settlements_tenant_isolation'
  ) THEN
    CREATE POLICY settlements_tenant_isolation
      ON settlements
      FOR ALL
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMENT ON TABLE settlements IS
  'Commercial chain L8 settlement record. One row per CoC final-step '
  'signature. Computes gross/royalty/fee/net in TZS, stamps the '
  'double-entry ledger journal id (LedgerService.post()), and tracks '
  'the M-Pesa B2C / wallet payout to the seller. Tenant-scoped RLS '
  'FORCE per CLAUDE.md hard rule.';

COMMIT;
