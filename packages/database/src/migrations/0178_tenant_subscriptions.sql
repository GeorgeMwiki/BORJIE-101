-- =============================================================================
-- Migration 0178 — tenant_subscriptions: the platform's own SaaS revenue
-- read-model.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The owner-portal BillingPage (GET /api/v1/billing/subscription) returned a
-- degraded `status: 'unknown'` object + `X-Backend-Status: degraded` because no
-- subscription store existed. This adds it: one ACTIVE subscription per tenant
-- representing the platform fee the mining owner pays Borjie. Per-tenant
-- operational invoices (rent/royalty) stay on the existing invoices path.
--
-- MONEY PATH (CLAUDE.md hard rule)
-- -------------------------------
-- This table is a READ-MODEL of subscription STATE — it stores NO posted ledger
-- lines. The actual platform-fee money moves through the established provider
-- PORT (IPaymentProvider in services/payments-ledger/src/providers) via the
-- PlatformBillingService adapter, and the resulting receivable posts through
-- LedgerService.post() exactly like every other money path. `external_id` is
-- the provider's subscription/customer handle so an at-least-once provider
-- webhook can reconcile state back here IDEMPOTENTLY. mrr_minor_units is BIGINT
-- minor units (integer minor units) and carries `currency` (ISO-4217) — NEVER a
-- hardcoded TZS/USD.
--
-- HARD RULES HONOURED (CLAUDE.md)
-- -------------------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true). REVOKE anon (guarded).
--   * provider/status are TEXT (+ app-level zod validation) — no pg_enum so the
--     migration stays forward-only + re-runnable.
--   * At most ONE active subscription per tenant: partial UNIQUE index on
--     cancelled_at IS NULL. A soft-cancelled row frees the slot.
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard +
-- pg_roles anon guard. Append-only per CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  external_id      TEXT,
  provider         TEXT,
  plan             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'unknown',
  mrr_minor_units  BIGINT NOT NULL DEFAULT 0,
  currency         TEXT NOT NULL,
  seats            INTEGER NOT NULL DEFAULT 0,
  renewal_at       TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most ONE active (non-cancelled) subscription per tenant. A soft-cancelled
-- row no longer occupies the slot, so re-subscribing after a cancel never
-- collides.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_subscriptions_active_uniq
  ON tenant_subscriptions(tenant_id)
  WHERE cancelled_at IS NULL;

-- Webhook reconciliation lookup: resolve a provider subscription back to its
-- row by (provider, external_id).
CREATE INDEX IF NOT EXISTS tenant_subscriptions_external_idx
  ON tenant_subscriptions(provider, external_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenant_subscriptions'
  ) THEN
    EXECUTE 'ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.tenant_subscriptions FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'tenant_subscriptions'
        AND policyname = 'tenant_subscriptions_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY tenant_subscriptions_tenant_isolation
        ON public.tenant_subscriptions
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.tenant_subscriptions FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE tenant_subscriptions IS
  'Platform SaaS revenue read-model: one ACTIVE subscription per tenant (the '
  'platform fee the owner pays Borjie). State-only — stores NO posted ledger '
  'lines; the platform-fee money moves through the provider PORT '
  '(IPaymentProvider) + LedgerService.post(), and external_id reconciles '
  'at-least-once provider webhooks back here idempotently. mrr_minor_units is '
  'BIGINT minor units + ISO-4217 currency (never hardcoded). At most one active '
  'subscription per tenant (partial unique on cancelled_at IS NULL). Backs GET '
  '/api/v1/billing/subscription. Tenant-scoped FORCE RLS on app.current_tenant_id. '
  'Added in 0178.';

COMMIT;
