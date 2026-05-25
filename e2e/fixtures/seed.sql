-- =============================================================================
-- E2E test-data seed (idempotent)
-- =============================================================================
-- Run via `e2e/fixtures/seed-runner.ts` AFTER api-gateway migrations have
-- created the schema. Inserts a known tenant, customer, property, unit, and
-- lease with STABLE UUIDs so customer-app specs can reference them by id
-- without first having to read them back from the API.
--
-- IDs match the constants in e2e/fixtures/test-data.ts (testIds.*).
--
-- Idempotency: every INSERT uses `ON CONFLICT (id) DO NOTHING` so re-running
-- against an already-seeded DB is a no-op. We intentionally do NOT truncate —
-- between CI runs the postgres container is recreated with `down -v`.
-- =============================================================================

-- ---------- Tenant ----------
INSERT INTO tenants (id, name, slug, status, created_at, updated_at)
VALUES (
  'tnt_e2e_0001',
  'E2E Test Properties',
  'e2e-test-properties',
  'active',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ---------- Users ----------
-- Test customer with deterministic phone for OTP login flow. Password column
-- only matters for the email-password portals; the customer-app uses phone OTP
-- and the test environment treats `123456` as the accepted code.
INSERT INTO users (id, tenant_id, email, phone, full_name, role, status, password_hash, created_at, updated_at)
VALUES (
  'usr_e2e_customer_0001',
  'tnt_e2e_0001',
  'e2e-customer@borjie.test',
  '+254712345678',
  'E2E Test Customer',
  'customer',
  'active',
  -- bcrypt of "demo123" — only used by the email-password admin/owner portals
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, tenant_id, email, full_name, role, status, password_hash, created_at, updated_at)
VALUES (
  'usr_e2e_admin_0001',
  'tnt_e2e_0001',
  'e2e-admin@borjie.test',
  'E2E Test Admin',
  'admin',
  'active',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ---------- Property + Unit ----------
INSERT INTO properties (id, tenant_id, name, address, status, created_at, updated_at)
VALUES (
  'prp_e2e_0001',
  'tnt_e2e_0001',
  'E2E Test Apartments',
  '123 Test Street, Nairobi, Kenya',
  'active',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO units (id, tenant_id, property_id, unit_number, status, monthly_rent, created_at, updated_at)
VALUES (
  'unt_e2e_0001',
  'tnt_e2e_0001',
  'prp_e2e_0001',
  'A101',
  'occupied',
  45000,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ---------- Lease ----------
INSERT INTO leases (
  id, tenant_id, unit_id, customer_id, status,
  start_date, end_date, monthly_rent, deposit, created_at, updated_at
)
VALUES (
  'lse_e2e_0001',
  'tnt_e2e_0001',
  'unt_e2e_0001',
  'usr_e2e_customer_0001',
  'active',
  NOW() - INTERVAL '60 days',
  NOW() + INTERVAL '305 days',
  45000,
  90000,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;
