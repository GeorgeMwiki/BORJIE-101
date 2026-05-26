-- =============================================================================
-- 0015: Explicit FK cascades + value check constraints
-- =============================================================================
-- Addresses audit findings:
--   - 67 FKs lacking explicit onDelete policy (orphan-record risk on tenant,
--     property, unit, customer deletion)
--   - Zero check constraints on monetary amounts, percentages, date ranges
--
-- Strategy: add constraints idempotently (CREATE IF NOT EXISTS + explicit
-- DROP…ADD for FK replacement where needed). Safe to run multiple times.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- FK onDelete policies — critical aggregates
-- -----------------------------------------------------------------------------
-- Leases must cascade with property/unit/customer deletion. Without an
-- explicit policy Postgres defaults to NO ACTION, which leaves orphan
-- leases pointing at a deleted parent and silently breaks tenant offboarding.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'leases_property_id_fkey') THEN
    ALTER TABLE leases DROP CONSTRAINT leases_property_id_fkey;
  END IF;
  ALTER TABLE leases ADD CONSTRAINT leases_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'leases_unit_id_fkey') THEN
    ALTER TABLE leases DROP CONSTRAINT leases_unit_id_fkey;
  END IF;
  ALTER TABLE leases ADD CONSTRAINT leases_unit_id_fkey
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE;

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'leases_customer_id_fkey') THEN
    ALTER TABLE leases DROP CONSTRAINT leases_customer_id_fkey;
  END IF;
  ALTER TABLE leases ADD CONSTRAINT leases_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
  -- RESTRICT on customer: we never want to silently wipe a customer's
  -- lease history; offboarding must explicitly soft-delete leases first.
END$$;

-- Invoices cascade from customer soft-delete path via application layer.
-- The hard delete should CASCADE so orphan invoices never leak.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'invoices_customer_id_fkey') THEN
    ALTER TABLE invoices DROP CONSTRAINT invoices_customer_id_fkey;
  END IF;
  ALTER TABLE invoices ADD CONSTRAINT invoices_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
END$$;

-- Ledger account FKs: customer/property deletions should null the
-- denormalized pointers (accounts survive because they hold immutable
-- financial history).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'accounts_customer_id_fkey') THEN
    ALTER TABLE accounts DROP CONSTRAINT accounts_customer_id_fkey;
  END IF;
  ALTER TABLE accounts ADD CONSTRAINT accounts_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;

  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'accounts_property_id_fkey') THEN
    ALTER TABLE accounts DROP CONSTRAINT accounts_property_id_fkey;
  END IF;
  ALTER TABLE accounts ADD CONSTRAINT accounts_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL;
END$$;

-- Ledger entries: must survive account deletion because they are the
-- audit trail. Use RESTRICT so an account with entries cannot be
-- dropped without an explicit migration that archives them first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'ledger_entries_account_id_fkey') THEN
    ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_account_id_fkey;
  END IF;
  ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_account_id_fkey
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
END$$;

-- Maintenance and inspections cascade with property deletion.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints
             WHERE constraint_name = 'maintenance_requests_property_id_fkey') THEN
    ALTER TABLE maintenance_requests DROP CONSTRAINT maintenance_requests_property_id_fkey;
  END IF;
  ALTER TABLE maintenance_requests ADD CONSTRAINT maintenance_requests_property_id_fkey
    FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE;
END$$;

-- -----------------------------------------------------------------------------
-- CHECK constraints — monetary amounts non-negative
-- -----------------------------------------------------------------------------
-- Negative amounts smuggled through a service bug have caused actual
-- double-credit incidents at other PropTech firms. DB-level floor is the
-- cheapest defense.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'invoices_total_non_negative') THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_total_non_negative CHECK (total_amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'invoices_balance_non_negative') THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_balance_non_negative CHECK (balance_amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'payments_amount_non_negative') THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_amount_non_negative CHECK (amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'leases_rent_non_negative') THEN
    ALTER TABLE leases
      ADD CONSTRAINT leases_rent_non_negative CHECK (rent_amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'leases_deposit_non_negative') THEN
    ALTER TABLE leases
      ADD CONSTRAINT leases_deposit_non_negative CHECK (security_deposit_amount >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'leases_date_range_valid') THEN
    ALTER TABLE leases
      ADD CONSTRAINT leases_date_range_valid CHECK (end_date >= start_date);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'leases_rent_due_day_valid') THEN
    ALTER TABLE leases
      ADD CONSTRAINT leases_rent_due_day_valid CHECK (rent_due_day BETWEEN 1 AND 31);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'leases_grace_period_non_negative') THEN
    ALTER TABLE leases
      ADD CONSTRAINT leases_grace_period_non_negative CHECK (grace_period_days >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'leases_notice_period_non_negative') THEN
    ALTER TABLE leases
      ADD CONSTRAINT leases_notice_period_non_negative CHECK (notice_period_days >= 0);
  END IF;
END$$;

-- Work-order cost columns: estimated_cost and actual_cost must be non-negative
-- when present (both are nullable so we only check when value exists).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'work_orders_estimated_cost_non_negative') THEN
    ALTER TABLE work_orders
      ADD CONSTRAINT work_orders_estimated_cost_non_negative
      CHECK (estimated_cost IS NULL OR estimated_cost >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints
                 WHERE constraint_name = 'work_orders_actual_cost_non_negative') THEN
    ALTER TABLE work_orders
      ADD CONSTRAINT work_orders_actual_cost_non_negative
      CHECK (actual_cost IS NULL OR actual_cost >= 0);
  END IF;
END$$;

-- -----------------------------------------------------------------------------
-- Helpful composite indexes for tenant-scoped soft-delete queries
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customers_tenant_active
  ON customers(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leases_tenant_active
  ON leases(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_active
  ON invoices(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_active
  ON work_orders(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- End of 0015
