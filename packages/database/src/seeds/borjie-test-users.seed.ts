/**
 * Borjie — Dev test users seed
 *
 * DEV-ONLY. Refuses to run when NODE_ENV === 'production'.
 *
 * Seeds one demo mining tenant (Mawe Bora Mining Ltd) plus five role-bound
 * test users covering every Borjie persona: borjie_admin, owner, site_manager,
 * employee (driver), buyer. Reads credentials from SEED_TEST_* env vars so
 * passwords are never committed.
 *
 * Run: pnpm tsx packages/database/src/seeds/borjie-test-users.seed.ts
 */

import bcrypt from 'bcrypt';
import { createDatabaseClient } from '../client.js';
import { tenants, users } from '../schemas/index.js';

type SeedUser = {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  role:
    | 'borjie_team'
    | 'owner'
    | 'site_manager'
    | 'driver'
    | 'buyer';
  preferredLang: 'sw' | 'en';
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'borjie-test-users.seed.ts refuses to run with NODE_ENV=production',
    );
  }

  if (optionalEnv('SEED_TEST_USERS', 'true') !== 'true') {
    console.log('[seed] SEED_TEST_USERS != true — skipping');
    return;
  }

  const tenantId = optionalEnv('SEED_TEST_TENANT_ID', 'borjie-demo');
  const tenantName = optionalEnv(
    'SEED_TEST_TENANT_NAME',
    'Mawe Bora Mining Ltd',
  );

  const seedUsers: SeedUser[] = [
    {
      email: requireEnv('SEED_TEST_BORJIE_ADMIN_EMAIL'),
      password: requireEnv('SEED_TEST_BORJIE_ADMIN_PASSWORD'),
      fullName: 'Borjie Admin',
      phone: '+255700000001',
      role: 'borjie_team',
      preferredLang: 'en',
    },
    {
      email: requireEnv('SEED_TEST_OWNER_EMAIL'),
      password: requireEnv('SEED_TEST_OWNER_PASSWORD'),
      fullName: 'Mzee Mwanaidi Komba',
      phone: '+255700000002',
      role: 'owner',
      preferredLang: 'sw',
    },
    {
      email: requireEnv('SEED_TEST_MANAGER_EMAIL'),
      password: requireEnv('SEED_TEST_MANAGER_PASSWORD'),
      fullName: 'Mama Asha Mwakasege',
      phone: '+255700000003',
      role: 'site_manager',
      preferredLang: 'sw',
    },
    {
      email: requireEnv('SEED_TEST_EMPLOYEE_EMAIL'),
      password: requireEnv('SEED_TEST_EMPLOYEE_PASSWORD'),
      fullName: 'Juma Hassan',
      phone: '+255700000004',
      role: 'driver',
      preferredLang: 'sw',
    },
    {
      email: requireEnv('SEED_TEST_BUYER_EMAIL'),
      password: requireEnv('SEED_TEST_BUYER_PASSWORD'),
      fullName: 'Pamoja Refinery Procurement',
      phone: '+255700000005',
      role: 'buyer',
      preferredLang: 'en',
    },
  ];

  const db = createDatabaseClient();

  console.log(`[seed] Upserting tenant ${tenantId} (${tenantName})`);
  await db
    .insert(tenants)
    .values({
      id: tenantId,
      name: tenantName,
      country: 'TZ',
      plan: 'mkulima',
    })
    .onConflictDoNothing();

  for (const u of seedUsers) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    console.log(`[seed] Upserting ${u.role}: ${u.email}`);
    await db
      .insert(users)
      .values({
        id: `${tenantId}-${u.role}`,
        tenantId,
        fullName: u.fullName,
        phone: u.phone,
        role: u.role,
        preferredLang: u.preferredLang,
        passwordHash,
      })
      .onConflictDoNothing();
  }

  console.log('[seed] Done. Test users available:');
  for (const u of seedUsers) {
    console.log(`  ${u.role.padEnd(15)} → ${u.email}`);
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
