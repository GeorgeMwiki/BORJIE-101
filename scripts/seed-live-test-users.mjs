#!/usr/bin/env node
/**
 * seed-live-test-users.mjs — create the BORJIE dev tenant + 3 dev
 * users in the live Supabase project, idempotently.
 *
 * Use this once after `pnpm db:migrate` against a fresh Supabase project
 * to make auth-gated routes testable end-to-end.
 *
 * What it does (all idempotent — re-runs cleanly converge):
 *
 *   1. INSERT the dev tenant row directly into `tenants` via DATABASE_URL.
 *      Slug = "dev-landlord", id stable, settings carry default currency.
 *
 *   2. For each of three dev users (owner, manager, tenant):
 *
 *      a. Call Supabase Auth Admin API `POST /auth/v1/admin/users` to
 *         create an `auth.users` row with email + password + auto-confirm.
 *
 *      b. Set `app_metadata` to:
 *           { tenant_id: <dev tenant id>,
 *             roles:     [<role>],
 *             environment: 'development' }
 *
 *         This is the **server-managed** metadata that
 *         `verifySupabaseJwt` trusts — F6 hardening rejects any
 *         tenant_id sourced from `user_metadata`.
 *
 *      c. Mirror the user into the app-level `users` table so app code
 *         that joins on user_id resolves correctly.
 *
 *   3. Print a summary table with user IDs and login commands a developer
 *      can paste into curl / Postman / the gateway smoke test.
 *
 * Required environment (read from .env.local — already in repo gitignore):
 *
 *   SUPABASE_URL                  → https://<ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     → server-only key, NEVER ship to client
 *   DATABASE_URL                  → Postgres connection (session-mode pooler)
 *
 * Optional:
 *
 *   BORJIE_DEV_TENANT_ID      → override default tenant id
 *   BORJIE_BOOTSTRAP_PASSWORD → override default password
 *
 * Exit codes:
 *   0 — all users + tenant present (newly created OR already there)
 *   1 — fatal error (network / auth / SQL)
 *   2 — missing required env var
 *
 * Security note: this script writes only to the BORJIE dev Supabase
 * project (resolved from SUPABASE_URL). It will REFUSE to run if the URL
 * looks like a production hostname — see `assertNotProduction` below.
 */

import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// 1. env loading (no dotenv dep — read .env.local manually so this script
//    can run with `node scripts/seed-live-test-users.mjs` directly).
// ---------------------------------------------------------------------------

function loadDotEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return; // .env.local missing → fall back to process.env
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const [, key, valRaw] = m;
    if (process.env[key]) continue; // don't clobber actual env
    const val = valRaw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    process.env[key] = val;
  }
}
loadDotEnvLocal();

function required(name) {
  const v = process.env[name];
  if (!v || /^TODO_/.test(v)) {
    console.error(`[seed-live-test-users] missing required env: ${name}`);
    process.exit(2);
  }
  return v;
}

function requiredOneOf(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && !/^TODO_/.test(v)) return v;
  }
  console.error(`[seed-live-test-users] missing required env (one of): ${names.join(', ')}`);
  process.exit(2);
}

const SUPABASE_URL = requiredOneOf(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']).replace(/\/+$/, '');
const SERVICE_ROLE = required('SUPABASE_SERVICE_ROLE_KEY');
const DATABASE_URL = required('DATABASE_URL');
const TENANT_ID = process.env.BORJIE_DEV_TENANT_ID ?? 'tnt_dev_landlord_001';
const TENANT_SLUG = 'dev-landlord';
const PASSWORD = process.env.BORJIE_BOOTSTRAP_PASSWORD ?? 'DevPass!Secure-2026';

function assertNotProduction() {
  // Belt-and-braces: refuse to seed dev users into a prod-looking project.
  if (/prod|production|live/i.test(SUPABASE_URL)) {
    console.error(
      `[seed-live-test-users] REFUSING to run — SUPABASE_URL looks like production: ${SUPABASE_URL}`,
    );
    process.exit(1);
  }
}
assertNotProduction();

// ---------------------------------------------------------------------------
// 2. The three dev users. Roles map onto UserRole in the gateway.
// ---------------------------------------------------------------------------

const USERS = [
  {
    email: 'owner@borjie.dev',
    firstName: 'Dev',
    lastName: 'Owner',
    roles: ['OWNER', 'admin'],
    isOwner: true,
  },
  {
    email: 'manager@borjie.dev',
    firstName: 'Dev',
    lastName: 'Manager',
    roles: ['MANAGER', 'manager'],
    isOwner: false,
  },
  {
    email: 'tenant@borjie.dev',
    firstName: 'Dev',
    lastName: 'Tenant',
    roles: ['TENANT', 'employee'],
    isOwner: false,
  },
];

// ---------------------------------------------------------------------------
// 3. Supabase Admin API helpers — POST to /auth/v1/admin/users.
// ---------------------------------------------------------------------------

async function adminApi(pathSuffix, init = {}) {
  const url = `${SUPABASE_URL}${pathSuffix}`;
  const headers = {
    apikey: SERVICE_ROLE,
    Authorization: `Bearer ${SERVICE_ROLE}`,
    'Content-Type': 'application/json',
    ...(init.headers ?? {}),
  };
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

async function findUserByEmail(email) {
  // The list endpoint paginates — for the dev set (3 users) page 1 is
  // sufficient. Server-side filtering on email isn't supported.
  const { ok, body, status } = await adminApi('/auth/v1/admin/users?page=1&per_page=200');
  if (!ok) throw new Error(`list users failed (${status}): ${JSON.stringify(body)}`);
  const users = Array.isArray(body?.users) ? body.users : [];
  return users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function createSupabaseUser(user) {
  // Try to find first — Admin API returns 422 on duplicate emails, so
  // we converge by patching the existing record instead.
  const existing = await findUserByEmail(user.email);
  const payload = {
    email: user.email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata: {
      tenant_id: TENANT_ID,
      roles: user.roles,
      environment: 'development',
    },
    user_metadata: {
      first_name: user.firstName,
      last_name: user.lastName,
      // NEVER put tenant_id here — F6 would reject the token.
    },
  };
  if (existing) {
    // PATCH to refresh metadata (in case roles or tenant_id changed).
    const { ok, body, status } = await adminApi(
      `/auth/v1/admin/users/${encodeURIComponent(existing.id)}`,
      { method: 'PUT', body: JSON.stringify(payload) },
    );
    if (!ok) throw new Error(`update user ${user.email} failed (${status}): ${JSON.stringify(body)}`);
    return { id: existing.id, alreadyExisted: true };
  }
  const { ok, body, status } = await adminApi('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!ok) throw new Error(`create user ${user.email} failed (${status}): ${JSON.stringify(body)}`);
  return { id: body?.id ?? body?.user?.id, alreadyExisted: false };
}

// ---------------------------------------------------------------------------
// 4. SQL helpers — tenant insert + app-level users row mirror.
// ---------------------------------------------------------------------------

async function ensureTenantAndAppUsers(sql, createdUsers) {
  return await sql.begin(async (tx) => {
    // Tenant — ON CONFLICT DO NOTHING is idempotent on slug.
    const existingTenant = await tx`
      SELECT id FROM tenants WHERE slug = ${TENANT_SLUG} AND deleted_at IS NULL LIMIT 1
    `;
    let tenantId = existingTenant.length ? existingTenant[0].id : TENANT_ID;
    if (!existingTenant.length) {
      await tx`
        INSERT INTO tenants (
          id, name, slug, status, primary_email, country, settings,
          created_at, updated_at, created_by
        ) VALUES (
          ${tenantId},
          'Dev Landlord (BORJIE local)',
          ${TENANT_SLUG},
          'active',
          'owner@borjie.dev',
          'TZ',
          ${JSON.stringify({ currency: 'TZS', timezone: 'Africa/Dar_es_Salaam', dev: true })}::jsonb,
          NOW(),
          NOW(),
          'seed-live-test-users'
        )
        ON CONFLICT (slug) DO NOTHING
      `;
    }
    // App-level users — one row per Supabase user, idempotent by
    // (tenant_id, email). The link to Supabase auth.users is by email
    // match (the schema does not carry a separate supabase_user_id column;
    // gateway middleware joins app users on email after verifying the JWT).
    for (const { email, firstName, lastName, isOwner } of createdUsers) {
      const existing = await tx`
        SELECT id FROM users
         WHERE tenant_id = ${tenantId} AND email = ${email} AND deleted_at IS NULL
         LIMIT 1
      `;
      if (existing.length === 0) {
        const appUserId = `usr_${randomUUID()}`;
        await tx`
          INSERT INTO users (
            id, tenant_id, email, phone, first_name, last_name,
            status, is_owner, created_at, updated_at, created_by
          ) VALUES (
            ${appUserId}, ${tenantId}, ${email}, NULL, ${firstName}, ${lastName},
            'active', ${isOwner}, NOW(), NOW(), 'seed-live-test-users'
          )
          ON CONFLICT DO NOTHING
        `;
      }
    }
    return tenantId;
  });
}

// ---------------------------------------------------------------------------
// 5. Main.
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[seed-live-test-users] target Supabase: ${SUPABASE_URL}`);
  console.log(`[seed-live-test-users] tenant id:      ${TENANT_ID}  (slug=${TENANT_SLUG})`);

  // First create Supabase users so we know their UUIDs before mirroring.
  const created = [];
  for (const u of USERS) {
    const { id, alreadyExisted } = await createSupabaseUser(u);
    created.push({
      ...u,
      supabaseUserId: id,
      alreadyExisted,
    });
    console.log(`  ${alreadyExisted ? 'exists' : 'created'}: ${u.email}  →  auth.users id = ${id}`);
  }

  // Mirror into app DB.
  const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
  try {
    const finalTenantId = await ensureTenantAndAppUsers(sql, created);
    console.log(`[seed-live-test-users] tenant convergence OK (id = ${finalTenantId})`);
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log('\nLogin via Supabase Auth REST (example for owner):');
  console.log(`  curl -X POST ${SUPABASE_URL}/auth/v1/token?grant_type=password \\`);
  console.log(`    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"email":"owner@borjie.dev","password":"${PASSWORD}"}'`);
  console.log('\nThen call any gateway authed route with the returned access_token.');
}

main().catch((err) => {
  console.error('[seed-live-test-users] FAILED:', err?.stack || err);
  process.exit(1);
});
