#!/usr/bin/env node
/**
 * quick-create-owner.ts — one-shot dev provisioning that bypasses the
 * (currently unmounted) /api/v1/orgs/signup endpoint.
 *
 * 1. Loads .env.local for SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *    DATABASE_URL.
 * 2. Creates a confirmed Supabase auth user with a known password.
 * 3. Inserts a `tenants` row + a `users` row linking the Supabase user
 *    to the tenant, with `mining_role='owner'` + `is_owner=true`.
 * 4. Sets `raw_app_meta_data.tenant_id` on the Supabase user so the
 *    api-gateway middleware can resolve the tenant context from the
 *    JWT app_metadata claim.
 * 5. Prints credentials.
 *
 * Idempotent: if the user already exists, fetches and converges. If
 * the tenants/users rows exist, leaves them alone.
 *
 * Usage:
 *   pnpm tsx scripts/quick-create-owner.ts
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const EMAIL = process.env['QCO_EMAIL'] ?? 'owner@borjie.test';
const PASSWORD = process.env['QCO_PASSWORD'] ?? 'BorjieOwner2026!';
const PHONE = process.env['QCO_PHONE'] ?? '+255700100200';
const ORG_NAME = process.env['QCO_ORG'] ?? 'Acme Mining Co (dev)';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main(): Promise<void> {
  const supabaseUrl = req('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = req('SUPABASE_SERVICE_ROLE_KEY');
  const dbUrl = req('DATABASE_URL');

  if (/prod|production|live/i.test(dbUrl)) {
    throw new Error('DATABASE_URL looks like production — refusing to run');
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const sql = postgres(dbUrl, { max: 2, onnotice: () => undefined });

  try {
    // 1. Create / fetch Supabase auth user
    let userId: string | null = null;
    const created = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      phone: PHONE,
      phone_confirm: true,
      user_metadata: { full_name: 'Borjie Dev Owner' },
    });
    if (created.error) {
      // Existing user → list and find by email
      if (
        created.error.message.includes('already') ||
        created.error.message.includes('registered') ||
        created.error.message.toLowerCase().includes('duplicate')
      ) {
        const list = await admin.auth.admin.listUsers({ perPage: 200 });
        if (list.error) throw list.error;
        const existing = list.data.users.find((u) => u.email === EMAIL);
        if (!existing) throw new Error(`Existing user not found for ${EMAIL}`);
        userId = existing.id;
        // Reset the password so the user knows what to log in with.
        const upd = await admin.auth.admin.updateUserById(userId, {
          password: PASSWORD,
        });
        if (upd.error) throw upd.error;
        process.stdout.write(`  · supabase user existed, password reset\n`);
      } else {
        throw created.error;
      }
    } else {
      userId = created.data.user?.id ?? null;
      process.stdout.write(`  · created supabase user\n`);
    }
    if (!userId) throw new Error('No user id from supabase');

    // 2. Upsert tenant (using only columns that exist in dev DB schema)
    const existingTenant = await sql<
      { id: string }[]
    >`SELECT id FROM tenants WHERE name = ${ORG_NAME} LIMIT 1`;
    let tenantId: string;
    if (existingTenant[0]) {
      tenantId = existingTenant[0].id;
      process.stdout.write(`  · tenant existed: ${tenantId}\n`);
    } else {
      const newTenantId = randomUUID();
      const slug = ORG_NAME.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO tenants (id, name, slug, country, status, plan, primary_email, primary_phone)
        VALUES (${newTenantId}, ${ORG_NAME}, ${slug}, 'TZ', 'active', 'mwanzo', ${EMAIL}, ${PHONE})
        RETURNING id
      `;
      const row = inserted[0];
      if (!row) throw new Error('tenant insert returned no row');
      tenantId = row.id;
      process.stdout.write(`  · created tenant: ${tenantId}\n`);
    }

    // 3. Upsert app user. Schema has no `supabase_user_id` column;
    //    the JWT auth bridge resolves email → users row within the
    //    tenant scope claimed by `app_metadata.tenant_id`. So we key
    //    idempotency on (tenant_id, email) instead.
    const existingUser = await sql<
      { id: string }[]
    >`SELECT id FROM users WHERE tenant_id = ${tenantId} AND email = ${EMAIL} LIMIT 1`;
    if (existingUser[0]) {
      process.stdout.write(`  · app user existed: ${existingUser[0].id}\n`);
    } else {
      const newUserId = randomUUID();
      const inserted = await sql<{ id: string }[]>`
        INSERT INTO users (
          id, tenant_id, email, phone, first_name, last_name,
          status, is_owner, mining_role, preferred_lang,
          mfa_enabled, failed_login_attempts, must_change_password
        )
        VALUES (
          ${newUserId}, ${tenantId}, ${EMAIL}, ${PHONE},
          'Borjie', 'Owner',
          'active', true, 'owner', 'sw',
          false, 0, false
        )
        RETURNING id
      `;
      const row = inserted[0];
      if (!row) throw new Error('users insert returned no row');
      process.stdout.write(`  · created app user: ${row.id}\n`);
    }

    // 4. Set app_metadata.tenant_id so JWT carries the claim
    const upd = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { tenant_id: tenantId, mining_role: 'owner' },
    });
    if (upd.error) throw upd.error;
    process.stdout.write(`  · app_metadata.tenant_id set\n`);

    process.stdout.write('\n');
    process.stdout.write('─── BORJIE DEV OWNER READY ─────────────────────\n');
    process.stdout.write(`  email      : ${EMAIL}\n`);
    process.stdout.write(`  password   : ${PASSWORD}\n`);
    process.stdout.write(`  phone      : ${PHONE}\n`);
    process.stdout.write(`  tenant id  : ${tenantId}\n`);
    process.stdout.write(`  user id    : ${userId}\n`);
    process.stdout.write(`  sign in at : http://localhost:3010/sign-in\n`);
    process.stdout.write('────────────────────────────────────────────────\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((err) => {
  process.stderr.write(
    `[quick-create-owner] ${err instanceof Error ? err.message : String(err)}\n`,
  );
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
  process.exit(1);
});
