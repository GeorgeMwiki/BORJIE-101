-- =============================================================================
-- DOWN 0315 — drop the RLS tenant_id access-path indexes.   DEV/STAGING ONLY.
--
-- Reverses 0315_rls_tenant_id_indexes.sql by dropping the `idx_<table>_tenant_id`
-- btree indexes it created. Index-only, so there is NO data loss and NO change
-- to row visibility either direction — dropping an access-path index only makes
-- the RLS predicate fall back to a sequential scan (slower), never less
-- isolated.
--
-- Transaction-safe: plain `DROP INDEX IF EXISTS` (NOT CONCURRENTLY) so it runs
-- inside the runner's per-file transaction wrapper. Idempotent / re-runnable.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  t text;
  hot_tables text[] := ARRAY[
    'ledger_entries',
    'marketplace_bids',
    'marketplace_listings',
    'junior_marketplace_listings',
    'bid_negotiations',
    'bid_messages',
    'request_for_bids',
    'request_for_bid_responses',
    'offtake_queue',
    'buyer_kyc_records',
    'procurement_kyc_documents',
    'buyer_notifications',
    'notifications_outbox',
    'notification_dispatch_log',
    'threads',
    'intelligence_corpus_chunks',
    'agent_memory',
    'ai_audit_chain'
  ];
BEGIN
  FOREACH t IN ARRAY hot_tables
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I;', 'idx_' || t || '_tenant_id');
  END LOOP;
END$$;

COMMIT;
