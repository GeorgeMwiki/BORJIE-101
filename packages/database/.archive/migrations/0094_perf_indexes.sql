-- Wave 25 Agent V — DB performance: composite (tenant_id, X) indexes
--
-- Context: the existing schema has single-column btree indexes on
-- tenant_id and on the filter column (status, customer_id, lease_id,
-- etc.), so Postgres must intersect two bitmap scans for every
-- multi-tenant query.  A composite (tenant_id, X) index lets the
-- planner walk a single btree and is dramatically faster for the
-- `WHERE tenant_id = ? AND X = ?` pattern that dominates our routes.
--
-- ADDITIVE ONLY: every statement is `CREATE INDEX IF NOT EXISTS`; no
-- drops, no renames, no semantics changes. Safe to re-run.

-- ---------------------------------------------------------------
-- invoices — route: /invoices?{customerId,leaseId,status}
-- Hot paths: findByCustomer, findByLease, findByStatus, findOverdue.
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_customer
  ON invoices(tenant_id, customer_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_lease
  ON invoices(tenant_id, lease_id)
  WHERE deleted_at IS NULL AND lease_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status
  ON invoices(tenant_id, status)
  WHERE deleted_at IS NULL;

-- findOverdue scans by (tenant_id, due_date) with status filter.
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_due_date
  ON invoices(tenant_id, due_date)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------
-- payments — route: /payments?{customerId,leaseId,status}
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payments_tenant_customer
  ON payments(tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_lease
  ON payments(tenant_id, lease_id)
  WHERE lease_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_tenant_invoice
  ON payments(tenant_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_tenant_status
  ON payments(tenant_id, status);

-- ---------------------------------------------------------------
-- leases — route: /leases?{status,propertyId,unitId,customerId}
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_leases_tenant_status
  ON leases(tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leases_tenant_customer
  ON leases(tenant_id, customer_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leases_tenant_unit
  ON leases(tenant_id, unit_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_leases_tenant_property
  ON leases(tenant_id, property_id)
  WHERE deleted_at IS NULL;

-- /leases/expiring filters by (tenant_id, status='active', end_date <= ?)
CREATE INDEX IF NOT EXISTS idx_leases_tenant_end_date
  ON leases(tenant_id, end_date)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------
-- customers — route: /customers?{status,search}
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customers_tenant_status
  ON customers(tenant_id, status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------
-- units — route: /units?{propertyId,status}
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_units_tenant_property
  ON units(tenant_id, property_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_units_tenant_status
  ON units(tenant_id, status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------
-- work_orders — route: /work-orders?{status,vendorId,propertyId}
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_status
  ON work_orders(tenant_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_vendor
  ON work_orders(tenant_id, vendor_id)
  WHERE deleted_at IS NULL AND vendor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_property
  ON work_orders(tenant_id, property_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_unit
  ON work_orders(tenant_id, unit_id)
  WHERE deleted_at IS NULL AND unit_id IS NOT NULL;

-- ---------------------------------------------------------------
-- vendors — route: /vendors?{status}
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_vendors_tenant_status
  ON vendors(tenant_id, status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------
-- properties — route: /properties?{status}
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_properties_tenant_status
  ON properties(tenant_id, status)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------
-- notifications — route: inbox, status dispatch
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_tenant_status
  ON notifications(tenant_id, status);

-- ---------------------------------------------------------------
-- arrears_cases — status-scoped dashboards
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_arrears_cases_tenant_status
  ON arrears_cases(tenant_id, status);

-- ---------------------------------------------------------------
-- ledger_entries — /statements reports filter by tenant + account + date
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ledger_entries_tenant_effective_date
  ON ledger_entries(tenant_id, effective_date);
