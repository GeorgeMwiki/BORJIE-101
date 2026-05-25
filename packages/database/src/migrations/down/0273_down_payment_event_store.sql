-- =============================================================================
-- DOWN 0273: revert payment_event_store.
--
-- WARNING: DATA LOSS — CRITICAL. The event store is the audit + replay
-- substrate for rent and arrears paths. Dropping the table loses every
-- payment-related domain event ever recorded. Down only on dev /
-- staging, never on prod without an export-then-restore plan.
--
-- Reverses: 0273_payment_event_store.sql:
--   - DROP triggers (notify + no_mutate)
--   - DROP trigger functions
--   - DROP indexes (stream_version, event_type_seq, tenant_seq)
--   - DROP RLS policies
--   - DROP TABLE payment_event_store
-- =============================================================================

DROP TRIGGER IF EXISTS payment_event_store_no_update_trg ON payment_event_store;
DROP TRIGGER IF EXISTS payment_event_store_notify_trg   ON payment_event_store;

DROP FUNCTION IF EXISTS payment_event_store_no_mutate();
DROP FUNCTION IF EXISTS payment_event_store_notify();

DROP INDEX IF EXISTS payment_event_store_tenant_seq_idx;
DROP INDEX IF EXISTS payment_event_store_event_type_seq_idx;
DROP INDEX IF EXISTS payment_event_store_stream_version_idx;

DROP POLICY IF EXISTS tenant_isolation_select ON public.payment_event_store;
DROP POLICY IF EXISTS tenant_isolation_modify ON public.payment_event_store;

DROP TABLE IF EXISTS public.payment_event_store CASCADE;
