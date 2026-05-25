/**
 * DB helpers for integration tests.
 *
 *   setupTestDb()    — drops+creates `borjie_test`, runs migrations,
 *                      seeds the minimum fixtures the tests require.
 *   resetDatabase()  — fast truncate of mutable tables between tests so
 *                      no test leaks state to its neighbours. Cheaper
 *                      than drop+recreate; safe because all test data
 *                      is re-seeded under stable ids in seedFixtures().
 *   cleanupTestDb()  — closes pools + drops the test DB. Idempotent.
 *   seedFixtures()   — inserts the minimal tenant/user/role/property/
 *                      unit/customer rows every test relies on.
 *
 * All helpers are deliberately low-level SQL via postgres-js — we do
 * NOT reuse the application's Drizzle client to avoid circular module
 * load issues and to keep the seed shape independent of ORM tweaks.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import bcrypt from 'bcrypt';
import { ADMIN_DATABASE_URL, TEST_DATABASE_URL, TEST_DB_NAME_EXPORT } from './test-env';

// Resolve the migrations dir via the workspace layout.
// services/api-gateway/test/integration/helpers -> packages/database/src/migrations
// IMPORTANT: use fileURLToPath so directories containing spaces or
// Unicode are resolved as real filesystem paths, not as percent-encoded
// URL components (which fs.readdir won't resolve).
const HELPERS_DIR = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(
  HELPERS_DIR,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'database',
  'src',
  'migrations'
);

// Stable ids the whole suite depends on.
export const TEST_TENANT_ID = 'tenant-int-001';
export const OTHER_TENANT_ID = 'tenant-int-002';
export const TEST_USER_ID = 'user-int-001';
export const TEST_ROLE_ID = 'role-int-admin';
export const TEST_PROPERTY_ID = 'prop-int-001';
export const TEST_UNIT_ID = 'unit-int-001';
export const TEST_OTHER_UNIT_ID = 'unit-int-002';
export const TEST_CUSTOMER_ID = 'cust-int-001';
export const TEST_USER_EMAIL = 'admin@integration-test.com';
export const TEST_USER_PASSWORD = 'Integration!Test123';

/**
 * Drop + create the test database so migrations run against a clean
 * slate. Connects to the `postgres` maintenance DB — `DROP DATABASE`
 * cannot run from inside the DB it is dropping.
 */
async function recreateDatabase(): Promise<void> {
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, idle_timeout: 2 });
  try {
    // Terminate any sessions still holding the DB open from a prior crash.
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = '${TEST_DB_NAME_EXPORT}' AND pid <> pg_backend_pid()`
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME_EXPORT}"`);
    await admin.unsafe(`CREATE DATABASE "${TEST_DB_NAME_EXPORT}"`);
  } finally {
    await admin.end({ timeout: 2 });
  }
}

async function runMigrations(sql: postgres.Sql): Promise<void> {
  await sql.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
    )
  `);
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    await sql.unsafe(content);
    await sql.unsafe(
      `INSERT INTO drizzle.__drizzle_migrations (hash) VALUES ('${file.replace('.sql', '')}')`
    );
  }
}

/**
 * Insert the minimum data each test relies on:
 *   - one test tenant (and a second tenant for cross-tenant checks)
 *   - one admin user with a known password
 *   - one admin role granting all permissions
 *   - a property, unit, and second unit to anchor marketplace/waitlist rows
 *   - a customer for negotiation/waitlist/gamification
 *   - an active reward policy so gamification endpoints can evaluate
 *
 * Called fresh on every `resetDatabase()` so tests can mutate freely.
 */
async function seedFixtures(sql: postgres.Sql): Promise<void> {
  const passwordHash = await bcrypt.hash(TEST_USER_PASSWORD, 4);

  await sql.unsafe(`
    INSERT INTO tenants (id, name, slug, status, primary_email)
      VALUES ('${TEST_TENANT_ID}', 'Integration Tenant', 'integration-tenant', 'active', 'tenant@integration.test');
    INSERT INTO tenants (id, name, slug, status, primary_email)
      VALUES ('${OTHER_TENANT_ID}', 'Other Tenant', 'other-tenant', 'active', 'other@integration.test');
  `);

  await sql.unsafe(
    `INSERT INTO users (id, tenant_id, email, password_hash, first_name, last_name, status)
       VALUES ('${TEST_USER_ID}', '${TEST_TENANT_ID}', '${TEST_USER_EMAIL}',
               '${passwordHash}', 'Test', 'Admin', 'active')`
  );

  await sql.unsafe(
    `INSERT INTO roles (id, tenant_id, name, display_name, permissions, priority, is_system)
       VALUES ('${TEST_ROLE_ID}', '${TEST_TENANT_ID}', 'tenant_admin', 'Tenant Admin',
               '["*"]'::jsonb, 100, true)`
  );

  await sql.unsafe(
    `INSERT INTO user_roles (id, user_id, role_id, tenant_id)
       VALUES ('ur-int-001', '${TEST_USER_ID}', '${TEST_ROLE_ID}', '${TEST_TENANT_ID}')`
  );

  await sql.unsafe(
    `INSERT INTO properties (
       id, tenant_id, owner_id, property_code, name, type,
       status, address_line1, city, country
     ) VALUES (
       '${TEST_PROPERTY_ID}', '${TEST_TENANT_ID}', '${TEST_USER_ID}',
       'P-001', 'Integration Tower', 'apartment_complex',
       'active', '1 Integration Way', 'Dar es Salaam', 'TZ'
     )`
  );

  await sql.unsafe(
    `INSERT INTO units (id, tenant_id, property_id, unit_code, name, type, status, base_rent_amount, base_rent_currency)
       VALUES ('${TEST_UNIT_ID}', '${TEST_TENANT_ID}', '${TEST_PROPERTY_ID}',
               'U-1A', 'Unit 1A', 'one_bedroom', 'vacant', 1000000, 'TZS')`
  );
  await sql.unsafe(
    `INSERT INTO units (id, tenant_id, property_id, unit_code, name, type, status, base_rent_amount, base_rent_currency)
       VALUES ('${TEST_OTHER_UNIT_ID}', '${TEST_TENANT_ID}', '${TEST_PROPERTY_ID}',
               'U-1B', 'Unit 1B', 'one_bedroom', 'vacant', 900000, 'TZS')`
  );

  await sql.unsafe(
    `INSERT INTO customers (
       id, tenant_id, customer_code, email, phone, first_name, last_name,
       status, kyc_status
     ) VALUES (
       '${TEST_CUSTOMER_ID}', '${TEST_TENANT_ID}', 'C-001', 'customer@int.test',
       '+255700000000', 'Aisha', 'Moyo', 'active', 'verified'
     )`
  );

  // Seed an active reward policy so gamification can evaluate without
  // the test needing to POST /policies first.
  await sql.unsafe(
    `INSERT INTO reward_policies (
       id, tenant_id, version, active, on_time_points,
       early_payment_bonus_points, late_penalty_points, streak_bonus_points,
       bronze_threshold, silver_threshold, gold_threshold, platinum_threshold,
       early_pay_discount_bps, early_pay_min_days_before,
       early_pay_max_credit_minor, late_fee_bps, late_fee_grace_days,
       late_fee_max_minor, cashback_enabled, cashback_bps,
       cashback_monthly_cap_minor, effective_from
     ) VALUES (
       'policy-int-001', '${TEST_TENANT_ID}', 1, true, 10,
       5, -15, 2,
       0, 100, 300, 600,
       0, 3,
       0, 0, 3,
       0, false, 0,
       0, now()
     )`
  );
}

const MUTABLE_TABLES: readonly string[] = [
  // Order matters only for FK cascades; we rely on TRUNCATE CASCADE to
  // handle the rest. List the *leaf* tables explicitly so truncate is a
  // single round-trip.
  'negotiation_turns',
  'negotiations',
  'negotiation_policies',
  'marketplace_listings',
  'tenders',
  'bids',
  'waitlist_outreach_events',
  'unit_waitlists',
  'reward_events',
  'tenant_gamification_profile',
  'reward_policies',
  'migration_runs',
  'user_roles',
  'roles',
  'customers',
  'units',
  'properties',
  'users',
  'tenants',
];

/**
 * Truncate all mutable tables and re-seed. Called from each suite's
 * `beforeEach` for strict isolation.
 *
 * Postgres TRUNCATE ... CASCADE is orders of magnitude faster than
 * DELETE for wide FK graphs — ~20 ms vs 500+ ms on this schema.
 */
export async function resetDatabase(sql: postgres.Sql): Promise<void> {
  const list = MUTABLE_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.unsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  await seedFixtures(sql);
}

/**
 * One-time global bootstrap. Creates the DB, runs all migrations, and
 * seeds fixtures. Subsequent tests call `resetDatabase` before each
 * `it` to restore known state.
 */
export async function setupTestDb(): Promise<postgres.Sql> {
  await recreateDatabase();
  const sql = postgres(TEST_DATABASE_URL, { max: 4, idle_timeout: 10 });
  await runMigrations(sql);
  await seedFixtures(sql);
  return sql;
}

/**
 * Drop the test DB. Usually called from the global teardown; safe to
 * call multiple times.
 */
export async function cleanupTestDb(sql?: postgres.Sql): Promise<void> {
  if (sql) {
    try {
      await sql.end({ timeout: 2 });
    } catch {
      // already closed
    }
  }
  const admin = postgres(ADMIN_DATABASE_URL, { max: 1, idle_timeout: 2 });
  try {
    await admin.unsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = '${TEST_DB_NAME_EXPORT}' AND pid <> pg_backend_pid()`
    );
    await admin.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME_EXPORT}"`);
  } finally {
    await admin.end({ timeout: 2 });
  }
}

