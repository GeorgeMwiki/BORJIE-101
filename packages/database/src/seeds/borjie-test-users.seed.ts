/**
 * Borjie — Dev test users seed
 *
 * DEV-ONLY. Refuses to run when NODE_ENV === 'production'.
 *
 * Seeds the demo mining tenant plus five role-bound test users covering every
 * Borjie persona: borjie_team (Borjie internal admin), owner, site_manager,
 * driver (employee), buyer.
 *
 * Reads credentials from SEED_TEST_* env vars so passwords are never committed.
 * Idempotent: re-running upserts and never duplicates.
 *
 * Run: pnpm tsx packages/database/src/seeds/borjie-test-users.seed.ts
 */

// @ts-nocheck — bcrypt has no @types; raw SQL inserts use parameterized queries.
import bcrypt from 'bcrypt';
import postgres from 'postgres';

type SeedRole = 'borjie_team' | 'owner' | 'site_manager' | 'driver' | 'buyer';

type SeedUser = {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: SeedRole;
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

  const databaseUrl = requireEnv('DATABASE_URL');
  const tenantId = optionalEnv('SEED_TEST_TENANT_ID', 'borjie-demo');
  const tenantName = optionalEnv('SEED_TEST_TENANT_NAME', 'Mawe Bora Mining Ltd');

  const seedUsers: SeedUser[] = [
    {
      id: `${tenantId}-borjie-admin`,
      email: requireEnv('SEED_TEST_BORJIE_ADMIN_EMAIL'),
      password: requireEnv('SEED_TEST_BORJIE_ADMIN_PASSWORD'),
      firstName: 'Borjie',
      lastName: 'Admin',
      phone: '+255700000001',
      role: 'borjie_team',
      preferredLang: 'en',
    },
    {
      id: `${tenantId}-owner`,
      email: requireEnv('SEED_TEST_OWNER_EMAIL'),
      password: requireEnv('SEED_TEST_OWNER_PASSWORD'),
      firstName: 'Mzee Mwanaidi',
      lastName: 'Komba',
      phone: '+255700000002',
      role: 'owner',
      preferredLang: 'sw',
    },
    {
      id: `${tenantId}-site-manager`,
      email: requireEnv('SEED_TEST_MANAGER_EMAIL'),
      password: requireEnv('SEED_TEST_MANAGER_PASSWORD'),
      firstName: 'Mama Asha',
      lastName: 'Mwakasege',
      phone: '+255700000003',
      role: 'site_manager',
      preferredLang: 'sw',
    },
    {
      id: `${tenantId}-driver`,
      email: requireEnv('SEED_TEST_EMPLOYEE_EMAIL'),
      password: requireEnv('SEED_TEST_EMPLOYEE_PASSWORD'),
      firstName: 'Juma',
      lastName: 'Hassan',
      phone: '+255700000004',
      role: 'driver',
      preferredLang: 'sw',
    },
    {
      id: `${tenantId}-buyer`,
      email: requireEnv('SEED_TEST_BUYER_EMAIL'),
      password: requireEnv('SEED_TEST_BUYER_PASSWORD'),
      firstName: 'Pamoja',
      lastName: 'Refinery',
      phone: '+255700000005',
      role: 'buyer',
      preferredLang: 'en',
    },
  ];

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    console.log(`[seed] Upserting tenant ${tenantId} (${tenantName})`);
    await sql`
      INSERT INTO tenants (id, name, slug, status, subscription_tier, plan, primary_email, country, region)
      VALUES (
        ${tenantId},
        ${tenantName},
        ${tenantId},
        'active',
        'enterprise',
        'kampuni',
        ${'admin@' + tenantId + '.borjie.dev'},
        'TZ',
        'af-south-1'
      )
      ON CONFLICT (id) DO NOTHING
    `;

    for (const u of seedUsers) {
      const passwordHash = await bcrypt.hash(u.password, 10);
      console.log(`[seed] Upserting ${u.role}: ${u.email}`);
      await sql`
        INSERT INTO users (
          id, tenant_id, email, password_hash,
          first_name, last_name, phone,
          status, is_owner, mining_role, preferred_lang,
          activated_at
        ) VALUES (
          ${u.id},
          ${tenantId},
          ${u.email},
          ${passwordHash},
          ${u.firstName},
          ${u.lastName},
          ${u.phone},
          'active',
          ${u.role === 'owner'},
          ${u.role},
          ${u.preferredLang},
          now()
        )
        ON CONFLICT (id) DO NOTHING
      `;
    }

    console.log('[seed] Done. Test users available:');
    for (const u of seedUsers) {
      console.log(`  ${u.role.padEnd(15)} → ${u.email}  (${u.firstName} ${u.lastName})`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
