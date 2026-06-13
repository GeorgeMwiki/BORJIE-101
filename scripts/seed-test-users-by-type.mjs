#!/usr/bin/env node
/**
 * seed-test-users-by-type.mjs — 6 ISOLATED mining estates, each with a FULL
 * role cast, created idempotently in the live Supabase project, then verified.
 *
 * Each index N is its OWN tenant (`tnt_estate_{N}` = "Mining Estate {N}"), so
 * every estate owns its own data — estate 1 can never see estate 2's. Within
 * each estate the five role-types let you exercise every permission tier:
 *
 *   owner{N}@borjie.test     → owner         (owns Mining Estate {N})
 *   admin{N}@borjie.test     → admin         (Borjie-internal platform admin)
 *   manager{N}@borjie.test   → site manager  (estate / site manager)
 *   employee{N}@borjie.test  → field worker  (miner / driver / equipment op)
 *   buyer{N}@borjie.test     → buyer         (mineral off-taker / counterparty)
 *
 * Role strings are mining-native — the gateway's Supabase role mapper accepts
 * `owner`, `admin`, `site_manager`, `driver`/`maintenance`, and `buyer`.
 *
 * Each user: auth.users row (email+password, auto-confirmed) with server-managed
 * app_metadata { tenant_id, roles, environment }, mirrored into the app `users`
 * table, then a real password-grant login proves the credential end-to-end.
 * Idempotent: re-runs converge (find-or-update, including re-homing a user that
 * was previously seeded into the old shared tenant).
 *
 * Env (from .env.local): SUPABASE_URL|NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnvLocal() {
  try {
    const raw = readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
    }
  } catch {
    /* fall back to process.env */
  }
}
loadDotEnvLocal();

const oneOf = (names) => names.map((n) => process.env[n]).find((v) => v && !/^TODO_/.test(v));
const SUPABASE_URL = (oneOf(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) || '').replace(/\/+$/, '');
const SERVICE_ROLE = oneOf(['SUPABASE_SERVICE_ROLE_KEY']);
const ANON_KEY = oneOf(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY']);
const DATABASE_URL = oneOf(['DATABASE_URL']);
for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_ROLE, ANON_KEY, DATABASE_URL })) {
  if (!v) { console.error(`missing env: ${k}`); process.exit(2); }
}

const PASSWORD = process.env.BORJIE_TEST_USER_PASSWORD ?? 'BorjieTest!2026';
const ESTATE_COUNT = 6;

// The five role-types every estate carries. `roles[]` is mining-native; the
// gateway mapper resolves each to the current enum slot.
const ROLE_TYPES = [
  { type: 'owner', label: 'Owner', firstName: 'Owner', roles: ['owner'], isOwner: true },
  { type: 'admin', label: 'Admin', firstName: 'Admin', roles: ['admin'], isOwner: false },
  { type: 'manager', label: 'Site Manager', firstName: 'SiteManager', roles: ['site_manager', 'manager'], isOwner: false },
  { type: 'employee', label: 'Field Worker', firstName: 'FieldWorker', roles: ['miner', 'driver'], isOwner: false },
  { type: 'buyer', label: 'Buyer', firstName: 'Buyer', roles: ['buyer'], isOwner: false },
];

async function adminApi(suffix, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${suffix}`, {
    ...init,
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

let _allUsers = null;
async function findByEmail(email) {
  if (!_allUsers) {
    const { body } = await adminApi('/auth/v1/admin/users?page=1&per_page=4000');
    _allUsers = body?.users ?? [];
  }
  return _allUsers.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function upsertUser(email, roles, tenantId, first, last) {
  const payload = {
    email, password: PASSWORD, email_confirm: true,
    app_metadata: { tenant_id: tenantId, roles, environment: 'development' },
    user_metadata: { first_name: first, last_name: last },
  };
  const existing = await findByEmail(email);
  if (existing) {
    await adminApi(`/auth/v1/admin/users/${encodeURIComponent(existing.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
    return { id: existing.id, existed: true };
  }
  const { ok, body, status } = await adminApi('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify(payload) });
  if (!ok) throw new Error(`create ${email} failed (${status}): ${JSON.stringify(body)}`);
  return { id: body?.id ?? body?.user?.id, existed: false };
}

async function verifyLogin(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && !!body?.access_token, status: res.status };
}

async function main() {
  console.log(`target: ${SUPABASE_URL}  password: ${PASSWORD}\n`);
  const all = [];
  const sql = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
  try {
    for (let n = 1; n <= ESTATE_COUNT; n += 1) {
      const tenantId = `tnt_estate_${n}`;
      const slug = `mining-estate-${n}`;
      await sql`INSERT INTO tenants (id, name, slug, status, primary_email, country, settings, created_at, updated_at, created_by)
        VALUES (${tenantId}, ${`Mining Estate ${n}`}, ${slug}, 'active', ${`owner${n}@borjie.test`}, 'TZ',
        ${sql.json({ currency: 'TZS', timezone: 'Africa/Dar_es_Salaam', sector: 'mining', dev: true })}, NOW(), NOW(), 'seed-by-type')
        ON CONFLICT (slug) DO NOTHING`;
      const t = await sql`SELECT id FROM tenants WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`;
      const realTenantId = t.length ? t[0].id : tenantId;

      for (const r of ROLE_TYPES) {
        const email = `${r.type}${n}@borjie.test`;
        const { existed } = await upsertUser(email, r.roles, realTenantId, r.firstName, `Estate${n}`);
        // Mirror into app users table (idempotent by email within tenant).
        const ex = await sql`SELECT id FROM users WHERE tenant_id = ${realTenantId} AND email = ${email} AND deleted_at IS NULL LIMIT 1`;
        if (!ex.length) {
          await sql`INSERT INTO users (id, tenant_id, email, phone, first_name, last_name, status, is_owner, created_at, updated_at, created_by)
            VALUES (${`usr_${randomUUID()}`}, ${realTenantId}, ${email}, NULL, ${r.firstName}, ${`Estate${n}`}, 'active', ${r.isOwner}, NOW(), NOW(), 'seed-by-type')
            ON CONFLICT DO NOTHING`;
        }
        all.push({ estate: n, type: r.type, label: r.label, email });
        process.stdout.write(`  ${existed ? 'exists ' : 'created'} estate${n} ${r.label.padEnd(13)} ${email}\n`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Verify login for every user.
  console.log('\nLogin verification:');
  let ok = 0;
  for (const u of all) {
    const r = await verifyLogin(u.email);
    if (r.ok) ok += 1; else console.log(`  ✗ ${u.email} (status ${r.status})`);
  }
  console.log(`\n  ${ok}/${all.length} users logged in ✓`);
  console.log('\nMining estates (each fully isolated by tenant, full role cast):');
  for (let n = 1; n <= ESTATE_COUNT; n += 1) {
    console.log(`  Mining Estate ${n} (tnt_estate_${n}): owner${n} + admin${n} + manager${n} + employee${n} + buyer${n}`);
  }
}

main().catch((e) => { console.error('FAILED:', e?.stack || e); process.exit(1); });
