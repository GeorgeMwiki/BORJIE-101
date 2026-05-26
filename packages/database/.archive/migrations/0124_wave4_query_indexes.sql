-- =============================================================================
-- 0124: Wave-4 D9 — query-pattern indexes for monthly-close + workers
-- =============================================================================
-- Audited query patterns shipped in waves 1-3:
--   * B1 monthly-close adapters (reconciliation / statement / disbursement /
--     notification) — period-bound payment aggregations + properties→leases→
--     invoices→payments joins.
--   * B3 listActiveUnits (market-surveillance) — units ⨝ properties ⨝ leases.
--   * B4 listActiveTenants (predictive-interventions) — 7-table aggregation
--     including payments / arrears_cases / cases / credit_rating /
--     intelligence_history.
--   * C1 pdf-renderer — owner_statements drain by (tenant, status='draft',
--     period_start).
--   * C2 payouts-worker — event_outbox picker by
--     (event_type='MonthlyCloseDisbursementProposed', status='pending').
--   * C3 dispatcher-worker — notification_dispatch_log claim by
--     (tenant_id, delivery_status='pending', created_at) with FOR UPDATE
--     SKIP LOCKED.
--
-- All statements use CREATE INDEX IF NOT EXISTS so this migration is safe
-- to re-run. No existing indexes are dropped or renamed.
--
-- Composite ordering rule: tenant-scoped indexes lead with tenant_id so
-- they remain useful for tenant-prefix scans as well as full-key lookups.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. payments — monthly-close period aggregations
--   Pattern: WHERE tenant_id = ? AND completed_at >= ? AND completed_at < ?
--            (often AND status = 'completed').
--   Existing `payments_completed_at_idx` is single-column; the composite
--   below adds tenant prefix so the planner can avoid bitmap-AND.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS payments_tenant_completed_at_idx
  ON payments (tenant_id, completed_at);

-- ----------------------------------------------------------------------------
-- 2. payments — predictive-interventions trailing-window aggregation
--   Pattern: WHERE tenant_id = ? AND created_at >= cutoff_6m
--            GROUP BY customer_id.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS payments_tenant_created_at_idx
  ON payments (tenant_id, created_at);

-- ----------------------------------------------------------------------------
-- 3. properties — owner-scoped joins in monthly-close adapters
--   Pattern: WHERE tenant_id = ? AND owner_id = ?
--   `properties_owner_idx` exists but lacks tenant; the composite gives
--   a single-walk lookup for the (tenant, owner) common predicate.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS properties_tenant_owner_idx
  ON properties (tenant_id, owner_id);

-- ----------------------------------------------------------------------------
-- 4. owner_statements — pdf-renderer draft drain
--   Pattern: WHERE tenant_id = ? AND status = 'draft'
--            (AND period_start = ?).
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS owner_statements_tenant_status_period_idx
  ON owner_statements (tenant_id, status, period_start);

-- ----------------------------------------------------------------------------
-- 5. event_outbox — payouts-worker batch picker
--   Pattern: WHERE event_type = ? AND status = 'pending'
--            ORDER BY created_at ASC LIMIT ?
--   Existing `event_outbox_status_created_idx` covers (status,
--   created_at) but not the event_type filter, which is the most
--   selective in this workload.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS event_outbox_event_type_status_created_idx
  ON event_outbox (event_type, status, created_at);

-- ----------------------------------------------------------------------------
-- 6. notification_dispatch_log — dispatcher-worker SKIP-LOCKED claim
--   Pattern: WHERE delivery_status = 'pending' AND tenant_id = ?
--            ORDER BY created_at ASC FOR UPDATE SKIP LOCKED.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS notification_dispatch_log_tenant_status_created_idx
  ON notification_dispatch_log (tenant_id, delivery_status, created_at);

-- ----------------------------------------------------------------------------
-- 7. cases — predictive-interventions disputes-90d aggregation
--   Pattern: WHERE tenant_id = ? AND case_type IN (...)
--            AND created_at >= cutoff_90d AND customer_id IS NOT NULL
--            GROUP BY customer_id.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS cases_tenant_type_created_idx
  ON cases (tenant_id, case_type, created_at);

-- End of 0124
