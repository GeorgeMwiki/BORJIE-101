-- Down 0364 — revert buyer_notifications kind CHECK + rfb_id NOT NULL.
-- Dev/staging only. FAILS if any bid_accepted/bid_rejected or rfb_id IS NULL
-- rows exist (clear those first). Guarded + idempotent.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.buyer_notifications') IS NOT NULL THEN
    ALTER TABLE buyer_notifications
      DROP CONSTRAINT IF EXISTS buyer_notifications_kind_chk;
    ALTER TABLE buyer_notifications
      ADD CONSTRAINT buyer_notifications_kind_chk
      CHECK (kind = ANY (ARRAY[
        'rfb_fulfilled', 'rfb_response_received', 'settlement_paid'
      ]));
    ALTER TABLE buyer_notifications ALTER COLUMN rfb_id SET NOT NULL;
  END IF;
END $$;
COMMIT;
