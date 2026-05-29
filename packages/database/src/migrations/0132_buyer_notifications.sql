-- =============================================================================
-- Migration 0132 — Buyer notifications queue
--
-- Commercial chain L7: when a worker submits the final chain-of-custody
-- step on a mining_tasks row with kind='rfb_fulfill' + parent_rfb_id set,
-- the CoC handler enqueues a buyer notification here. The buyer-mobile
-- `app/notifications.tsx` paginates the rows for the authenticated buyer.
--
-- Why a dedicated table (vs. piggybacking on `notification_dispatch_log`)?
--   * Buyer-mobile reads at-rest; the existing dispatch_log is the
--     egress queue for SMS/email/push channels. Keeping the BFF surface
--     separate from the dispatch substrate lets us drop the read latency
--     to a single PK index lookup.
--   * Buyer's view of the row is a SUBSET of the dispatch payload (no
--     channel-routing internals leak), so a separate projection avoids
--     leaking notifier-internal columns.
--
-- Tenant scope:
--   * `tenant_id` is the SELLER's tenant (the operator who fulfilled).
--   * `buyer_user_id` keys to the buyer's user row regardless of tenant.
--   * `buyer_tenant_id` is the BUYER's own tenant (cross-tenant by design
--     -- buyer-mobile reads its own tenant's RLS-scoped notifications).
--
-- RLS FORCE enabled. The select policy uses buyer_tenant_id so the
-- buyer-mobile reads only its own tenant's queue.
--
-- Forward-only. Append-only per CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS buyer_notifications (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Buyer's own tenant id — RLS predicate keys on this.
  buyer_tenant_id     uuid        NOT NULL,
  -- Buyer's user_id (foreign-key-free to allow cross-tenant resolution).
  buyer_user_id       text        NOT NULL,
  -- Seller's tenant + RFB cross-reference for analytics + the buyer-mobile
  -- "view RFB" deep link.
  seller_tenant_id    uuid        NOT NULL,
  rfb_id              uuid        NOT NULL,
  response_id         uuid,
  task_id             uuid,
  -- Notification kind. 'rfb_fulfilled' is the L7 trigger; reserved for
  -- future kinds (rfb_response_received, settlement_paid, etc.).
  kind                text        NOT NULL,
  -- Bilingual title + body for the buyer-mobile renderer.
  title_sw            text        NOT NULL,
  title_en            text        NOT NULL,
  body_sw             text        NOT NULL,
  body_en             text        NOT NULL,
  -- Free-form payload (e.g. ore-parcel id, attached photo url, ledger
  -- txn id). Renderer treats as opaque.
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Read receipt — null until the buyer-mobile marks it read.
  read_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT buyer_notifications_kind_chk CHECK (
    kind IN ('rfb_fulfilled', 'rfb_response_received', 'settlement_paid')
  )
);

-- Buyer-mobile reads: paginate by created_at DESC for the buyer's user_id
-- within their own tenant. The composite index covers the typical
-- "load my latest 50" path.
CREATE INDEX IF NOT EXISTS idx_buyer_notifications_tenant_user_created
  ON buyer_notifications (buyer_tenant_id, buyer_user_id, created_at DESC);

-- Unread badge: filter on read_at IS NULL within a tenant + user.
CREATE INDEX IF NOT EXISTS idx_buyer_notifications_unread
  ON buyer_notifications (buyer_tenant_id, buyer_user_id)
  WHERE read_at IS NULL;

-- Cross-ref for L8 settlement orchestration.
CREATE INDEX IF NOT EXISTS idx_buyer_notifications_rfb
  ON buyer_notifications (rfb_id);

ALTER TABLE buyer_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyer_notifications FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'buyer_notifications'
       AND policyname = 'buyer_notifications_tenant_isolation'
  ) THEN
    -- RLS predicate keys on buyer_tenant_id so a buyer in their own
    -- tenant only sees their notifications. Inserts run with the
    -- SELLER's app.current_tenant_id; we explicitly allow inserts
    -- whose buyer_tenant_id differs because the dispatch is cross-tenant.
    CREATE POLICY buyer_notifications_tenant_isolation
      ON buyer_notifications
      FOR ALL
      USING (
        buyer_tenant_id::text = current_setting('app.current_tenant_id', true)
        OR seller_tenant_id::text = current_setting('app.current_tenant_id', true)
      )
      WITH CHECK (
        seller_tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;

COMMENT ON TABLE buyer_notifications IS
  'Commercial chain L7 buyer notification queue. Seller-side handlers '
  'INSERT (RLS WITH CHECK keys on seller_tenant_id); the buyer-mobile '
  'READ surface keys on buyer_tenant_id so each buyer sees only their '
  'own tenant''s queue.';

COMMIT;
