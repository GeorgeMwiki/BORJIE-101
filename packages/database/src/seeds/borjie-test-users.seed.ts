/**
 * Borjie — Dev test users seed (Supabase Auth edition)
 *
 * DEV-ONLY. Refuses to run when NODE_ENV === 'production'.
 *
 * Provisions five role-bound test users covering every Borjie persona
 * (admin / owner / manager / employee / buyer) against the live
 * Supabase Auth project AND mirrors them into `public.users` so
 * tenant-scoped queries continue to resolve.
 *
 * Flow per user:
 *   1. supabase.auth.admin.createUser({ email, password, email_confirm,
 *      app_metadata: { tenant_id, mining_role }, user_metadata: {...} })
 *   2. If 422 "already exists" → look up via listUsers, then
 *      updateUserById to refresh password + metadata.
 *   3. INSERT INTO public.users with id = auth_user.id so the auth UUID
 *      is the link between auth.users and public.users.
 *
 * Idempotent: re-running upserts and never duplicates.
 *
 * Run: pnpm tsx packages/database/src/seeds/borjie-test-users.seed.ts
 */

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import postgres from 'postgres';
import { logger } from '../logger.js';

type SeedRole = 'borjie_team' | 'owner' | 'site_manager' | 'driver' | 'buyer';

interface SeedUser {
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly role: SeedRole;
  readonly preferredLang: 'sw' | 'en';
}

interface SeedTenant {
  readonly id: string;
  readonly name: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// TODO(supabase-migration): this whole seed runs against the local
// Postgres test DB. When the rewrite to the Supabase Auth Admin API
// lands the optionalEnv() helper goes away — every SEED_TEST_* will be
// required and dev-only defaults disappear with it.
function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function buildSeedUsers(): readonly SeedUser[] {
  return [
    {
      email: requireEnv('SEED_TEST_BORJIE_ADMIN_EMAIL'),
      password: requireEnv('SEED_TEST_BORJIE_ADMIN_PASSWORD'),
      firstName: 'Borjie',
      lastName: 'Admin',
      phone: '+255700000001',
      role: 'borjie_team',
      preferredLang: 'en',
    },
    {
      email: requireEnv('SEED_TEST_OWNER_EMAIL'),
      password: requireEnv('SEED_TEST_OWNER_PASSWORD'),
      firstName: 'Mzee Mwanaidi',
      lastName: 'Komba',
      phone: '+255700000002',
      role: 'owner',
      preferredLang: 'sw',
    },
    {
      email: requireEnv('SEED_TEST_MANAGER_EMAIL'),
      password: requireEnv('SEED_TEST_MANAGER_PASSWORD'),
      firstName: 'Mama Asha',
      lastName: 'Mwakasege',
      phone: '+255700000003',
      role: 'site_manager',
      preferredLang: 'sw',
    },
    {
      email: requireEnv('SEED_TEST_EMPLOYEE_EMAIL'),
      password: requireEnv('SEED_TEST_EMPLOYEE_PASSWORD'),
      firstName: 'Juma',
      lastName: 'Hassan',
      phone: '+255700000004',
      role: 'driver',
      preferredLang: 'sw',
    },
    {
      email: requireEnv('SEED_TEST_BUYER_EMAIL'),
      password: requireEnv('SEED_TEST_BUYER_PASSWORD'),
      firstName: 'Pamoja',
      lastName: 'Refinery',
      phone: '+255700000005',
      role: 'buyer',
      preferredLang: 'en',
    },
  ];
}

/**
 * Page through the Supabase admin listUsers endpoint until a match for
 * `email` is found (or every page is consumed). The Admin API does not
 * expose direct lookup-by-email yet, so paging is the supported path.
 */
async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<User | null> {
  const lowered = email.toLowerCase();
  let page = 1;
  const perPage = 200;
  // Cap pagination so a misconfigured project does not loop forever.
  const maxPages = 50;
  while (page <= maxPages) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`listUsers failed: ${error.message}`);
    }
    const found = data.users.find((u) => u.email?.toLowerCase() === lowered);
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
  return null;
}

/**
 * Create-or-update a Supabase Auth user. Returns the canonical Supabase
 * Auth UUID so the caller can mirror it into `public.users.id`.
 */
async function upsertAuthUser(
  supabase: SupabaseClient,
  tenantId: string,
  user: SeedUser,
): Promise<string> {
  const appMetadata = {
    tenant_id: tenantId,
    mining_role: user.role,
  } as const;
  const userMetadata = {
    first_name: user.firstName,
    last_name: user.lastName,
    preferred_lang: user.preferredLang,
  } as const;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  });

  if (!createError && created.user) {
    logger.info('seed: created auth user', { email: user.email, role: user.role });
    return created.user.id;
  }

  // Supabase returns 422 / specific message when the email is taken.
  const message = createError?.message ?? '';
  const status = (createError as { status?: number } | undefined)?.status;
  const alreadyExists =
    status === 422 ||
    /already (registered|been registered|exists)/i.test(message) ||
    /User already registered/i.test(message);
  if (!alreadyExists) {
    throw new Error(`createUser failed for ${user.email}: ${message}`);
  }

  const existing = await findAuthUserByEmail(supabase, user.email);
  if (!existing) {
    throw new Error(
      `createUser reported "already exists" for ${user.email} but listUsers did not return them`,
    );
  }

  const fullUpdate = await supabase.auth.admin.updateUserById(existing.id, {
    password: user.password,
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  });

  if (!fullUpdate.error && fullUpdate.data.user) {
    logger.info('seed: updated existing auth user', {
      email: user.email,
      role: user.role,
    });
    return fullUpdate.data.user.id;
  }

  // Supabase rejects passwords on update against its project-level
  // password policy (length, complexity). The initial createUser may
  // have predated the policy. On re-run we still want metadata to
  // converge — log a warning and retry without the password field.
  const isPasswordPolicy =
    /password/i.test(fullUpdate.error?.message ?? '') &&
    /(weak|character|policy|short)/i.test(fullUpdate.error?.message ?? '');
  if (!isPasswordPolicy) {
    throw new Error(
      `updateUserById failed for ${user.email}: ${fullUpdate.error?.message ?? 'unknown'}`,
    );
  }
  logger.warn(
    'seed: password rejected by Supabase policy on re-run — keeping existing password and updating metadata only',
    { email: user.email, policyMessage: fullUpdate.error?.message },
  );
  const metaOnly = await supabase.auth.admin.updateUserById(existing.id, {
    email_confirm: true,
    app_metadata: appMetadata,
    user_metadata: userMetadata,
  });
  if (metaOnly.error || !metaOnly.data.user) {
    throw new Error(
      `updateUserById (metadata-only) failed for ${user.email}: ${metaOnly.error?.message ?? 'unknown'}`,
    );
  }
  logger.info('seed: updated existing auth user (metadata only)', {
    email: user.email,
    role: user.role,
  });
  return metaOnly.data.user.id;
}

async function upsertTenant(
  sql: ReturnType<typeof postgres>,
  tenant: SeedTenant,
): Promise<void> {
  logger.info('seed: upserting tenant', { tenantId: tenant.id, name: tenant.name });
  await sql`
    INSERT INTO tenants (
      id, name, slug, status, subscription_tier, plan,
      primary_email, country, region
    ) VALUES (
      ${tenant.id},
      ${tenant.name},
      ${tenant.id},
      'active',
      'enterprise',
      'kampuni',
      ${'admin@' + tenant.id + '.borjie.dev'},
      'TZ',
      'af-south-1'
    )
    ON CONFLICT (id) DO NOTHING
  `;
}

async function upsertPublicUser(
  sql: ReturnType<typeof postgres>,
  authUserId: string,
  tenantId: string,
  user: SeedUser,
): Promise<void> {
  logger.info('seed: mirroring public.users row', {
    email: user.email,
    authUserId,
  });
  await sql`
    INSERT INTO users (
      id, tenant_id, email,
      first_name, last_name, phone,
      status, is_owner, mining_role, preferred_lang,
      activated_at
    ) VALUES (
      ${authUserId},
      ${tenantId},
      ${user.email},
      ${user.firstName},
      ${user.lastName},
      ${user.phone},
      'active',
      ${user.role === 'owner'},
      ${user.role},
      ${user.preferredLang},
      now()
    )
    ON CONFLICT (id) DO UPDATE SET
      tenant_id = EXCLUDED.tenant_id,
      email = EXCLUDED.email,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      phone = EXCLUDED.phone,
      status = EXCLUDED.status,
      is_owner = EXCLUDED.is_owner,
      mining_role = EXCLUDED.mining_role,
      preferred_lang = EXCLUDED.preferred_lang,
      activated_at = EXCLUDED.activated_at,
      updated_at = now()
  `;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'borjie-test-users.seed.ts refuses to run with NODE_ENV=production',
    );
  }

  if (optionalEnv('SEED_TEST_USERS', 'true') !== 'true') {
    logger.info('seed: SEED_TEST_USERS != true — skipping');
    return;
  }

  // Accept either canonical or NEXT_PUBLIC_ variant so the seed works
  // out of the box with the same `.env.local` the web apps consume.
  const supabaseUrl =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    requireEnv('SUPABASE_URL');
  const supabaseServiceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const databaseUrl = requireEnv('DATABASE_URL');
  const tenantId = optionalEnv('SEED_TEST_TENANT_ID', 'borjie-demo');
  const tenantName = optionalEnv('SEED_TEST_TENANT_NAME', 'Mawe Bora Mining Ltd');

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    await upsertTenant(sql, { id: tenantId, name: tenantName });

    const seedUsers = buildSeedUsers();
    const provisioned: Array<{ email: string; role: SeedRole; id: string }> = [];
    for (const user of seedUsers) {
      const authUserId = await upsertAuthUser(supabase, tenantId, user);
      await upsertPublicUser(sql, authUserId, tenantId, user);
      provisioned.push({ email: user.email, role: user.role, id: authUserId });
    }

    logger.info('seed: done', { count: provisioned.length });
    for (const p of provisioned) {
      logger.info(
        `seed: ${p.role.padEnd(15)} -> ${p.email}`,
        { id: p.id },
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  logger.error('seed: FAILED', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
