-- =============================================================================
-- Migration 0163 — webhook_events: durable, claim-after-commit webhook dedupe
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The payments-ledger webhook handlers (Stripe + M-Pesa) used a per-process
-- in-memory Set to suppress duplicate deliveries. That set is lost on restart
-- and is NOT shared across replicas, so a redelivered provider event after a
-- deploy (or one hitting a different pod) re-processed and DOUBLE-CREDITED the
-- immutable double-entry ledger. Stripe and Safaricom both deliver
-- AT-LEAST-ONCE and retry for days, so this was a real money-loss window.
--
-- THE FIX — a durable claim table (mirrors 0162 journal_idempotency)
-- ------------------------------------------------------------------
-- On receipt the handler INSERTs (provider, event_id). A unique-violation
-- (SQLSTATE 23505) on the composite PRIMARY KEY means DUPLICATE → the handler
-- acks 200 and skips processing; a clean insert means FIRST SIGHT → process.
-- The claim commits BEFORE the side effect, so a crash mid-process cannot
-- resurrect the event as first-seen on redelivery. (The ledger post is also
-- keyed on the same event id — defect #2 — as a post-once backstop.)
--
-- WHY (provider, event_id) AS THE KEY
-- -----------------------------------
-- Dedupe grain is one row per provider event. The composite PK gives the
-- UNIQUE guarantee the claim relies on and namespaces providers so a Stripe
-- `evt_…` can never collide with an M-Pesa `ws_CO_…`. tenant_id is carried
-- for RLS + audit, NOT for uniqueness (a provider event id is globally unique
-- within its provider).
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped table -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (mirrors 0162's CORRECT
--     GUC; never the legacy app.tenant_id). REVOKE anon (guarded for vanilla PG).
--   * No money columns here — this is a dedupe index only.
--
-- IDEMPOTENT / FORWARD-ONLY: IF NOT EXISTS + pg_policies existence guard +
-- pg_roles anon guard. Safe to re-run. Append-only per CLAUDE.md
-- "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — webhook_events
--
-- Composite PK (provider, event_id) supplies the UNIQUE guarantee the
-- duplicate-detection relies on. received_at is for ops/audit + future TTL
-- reaping. Column layout is byte-for-byte the payments-ledger service's local
-- Drizzle declaration (providers/webhook-dedupe-store.ts).
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS webhook_events (
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  tenant_id    TEXT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);

-- Tenant-scoped sweep / reporting index (e.g. retention reaping by tenant).
CREATE INDEX IF NOT EXISTS webhook_events_tenant_idx
  ON webhook_events(tenant_id);

-- -----------------------------------------------------------------------------
-- §2 — FORCE RLS + tenant-isolation policy.
--
-- Mirrors 0162 §2: current_setting('app.current_tenant_id', true). tenant_id is
-- TEXT so the compare is bare. FOR ALL covers the handler's INSERT + the
-- duplicate/exists SELECT. Idempotent: ENABLE/FORCE are no-ops if already set;
-- policy guarded by a pg_policies existence check.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'webhook_events'
  ) THEN
    EXECUTE 'ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.webhook_events FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'webhook_events'
        AND policyname = 'webhook_events_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY webhook_events_tenant_isolation ON public.webhook_events
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    -- anon role is a Supabase construct; guard so the migration still applies
    -- on a vanilla Postgres (CI empty-PG check / non-Supabase env).
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.webhook_events FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE webhook_events IS
  'Durable claim-after-commit webhook dedupe: PRIMARY KEY (provider, event_id) '
  '-> a redelivered Stripe/M-Pesa event hits a 23505 and is skipped instead of '
  'double-crediting the ledger. Survives restart + multi-replica. RLS FORCE on '
  'app.current_tenant_id. Added in 0163.';

COMMIT;
