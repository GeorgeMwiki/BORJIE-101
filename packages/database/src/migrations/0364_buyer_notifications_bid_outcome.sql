-- =============================================================================
-- Migration 0364 — buyer_notifications: allow marketplace bid-outcome kinds and
-- a NULL rfb_id (co-requirement of the seller-accept/reject -> buyer pulse fix).
--
-- WHY: seller accept/reject of a marketplace BID now enqueues a buyer_notifications
-- row (kind 'bid_accepted' / 'bid_rejected') inside the accept transaction so the
-- buyer is no longer left unaware of a binding offtake. A marketplace bid is NOT
-- tied to an RFB, so rfb_id is NULL. The existing kind CHECK only permits the RFB
-- + settlement kinds and rfb_id is NOT NULL, so without this the insert violates
-- two constraints and ROLLS BACK the whole bid-accept. This extends the kind CHECK
-- and drops the rfb_id NOT NULL.
--
-- Safe-class: extends one CHECK + relaxes one NOT NULL, idempotent + guarded, no
-- data touched. RLS unchanged (0132 WITH CHECK on seller_tenant_id still applies).
-- Forward-only.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.buyer_notifications') IS NOT NULL THEN
    ALTER TABLE buyer_notifications
      DROP CONSTRAINT IF EXISTS buyer_notifications_kind_chk;
    ALTER TABLE buyer_notifications
      ADD CONSTRAINT buyer_notifications_kind_chk
      CHECK (kind = ANY (ARRAY[
        'rfb_fulfilled', 'rfb_response_received', 'settlement_paid',
        'bid_accepted', 'bid_rejected'
      ]));
    ALTER TABLE buyer_notifications ALTER COLUMN rfb_id DROP NOT NULL;
  END IF;
END $$;

COMMIT;
