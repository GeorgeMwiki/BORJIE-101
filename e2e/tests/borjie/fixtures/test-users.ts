/**
 * Borjie seeded test users.
 *
 * Mirrors the SEED_TEST_* entries written into Postgres by
 * `scripts/seed-test-users.ts`. Passwords resolve at runtime from the
 * shell environment (loaded from .env.local for local dev, from CI
 * secrets in pipelines). When a variable is missing we fall back to the
 * seed default so a missing env never silently swaps in `undefined` and
 * masks the real auth failure.
 */

export type BorjieRole =
  | 'borjie_team'
  | 'owner'
  | 'site_manager'
  | 'driver'
  | 'buyer';

export interface BorjieTestUser {
  readonly role: BorjieRole;
  readonly email: string;
  readonly password: string;
  readonly tenantId: string;
}

const TENANT_ID = process.env['SEED_TEST_TENANT_ID'] ?? 'borjie-demo';

function readSecret(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const BORJIE_TEST_USERS: Readonly<Record<BorjieRole, BorjieTestUser>> = {
  borjie_team: {
    role: 'borjie_team',
    email:
      process.env['SEED_TEST_BORJIE_ADMIN_EMAIL'] ?? 'admin@borjie.dev',
    password: readSecret('SEED_TEST_BORJIE_ADMIN_PASSWORD', 'borjie-admin-dev'),
    tenantId: TENANT_ID,
  },
  owner: {
    role: 'owner',
    email: process.env['SEED_TEST_OWNER_EMAIL'] ?? 'owner@borjie.dev',
    password: readSecret('SEED_TEST_OWNER_PASSWORD', 'owner-dev'),
    tenantId: TENANT_ID,
  },
  site_manager: {
    role: 'site_manager',
    email: process.env['SEED_TEST_MANAGER_EMAIL'] ?? 'manager@borjie.dev',
    password: readSecret('SEED_TEST_MANAGER_PASSWORD', 'manager-dev'),
    tenantId: TENANT_ID,
  },
  driver: {
    role: 'driver',
    email: process.env['SEED_TEST_EMPLOYEE_EMAIL'] ?? 'employee@borjie.dev',
    password: readSecret('SEED_TEST_EMPLOYEE_PASSWORD', 'employee-dev'),
    tenantId: TENANT_ID,
  },
  buyer: {
    role: 'buyer',
    email: process.env['SEED_TEST_BUYER_EMAIL'] ?? 'buyer@borjie.dev',
    password: readSecret('SEED_TEST_BUYER_PASSWORD', 'buyer-dev'),
    tenantId: TENANT_ID,
  },
};

export const API_GATEWAY_URL =
  process.env['API_GATEWAY_URL'] ?? 'http://localhost:3001';

export const ADMIN_WEB_URL =
  process.env['ADMIN_WEB_URL'] ?? 'http://localhost:3020';

export const OWNER_WEB_URL =
  process.env['OWNER_WEB_URL'] ?? 'http://localhost:3010';

export const WORKFORCE_MOBILE_URL =
  process.env['WORKFORCE_MOBILE_URL'] ?? 'http://localhost:8081';

export const BUYER_MOBILE_URL =
  process.env['BUYER_MOBILE_URL'] ?? 'http://localhost:8082';
