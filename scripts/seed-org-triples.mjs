#!/usr/bin/env node
/**
 * seed-org-triples.mjs — 6 orgs (tenants), each with a LINKED triple:
 * one owner + one worker + one customer sharing the same tenant_id. 18 users,
 * idempotent, each login-verified.
 *
 *   org{i}-owner@borjie.test     → OWNER             (owns org {i})
 *   org{i}-worker@borjie.test    → MAINTENANCE_STAFF (field worker in org {i})
 *   org{i}-customer@borjie.test  → RESIDENT          (marketplace customer of org {i})
 *
 * Linkage = a shared `tenant_id` in server-managed app_metadata + a shared
 * tenant row + app `users` rows. Env from .env.local.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try {
  const raw = readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
  }
} catch { /* fall back to process.env */ }

const oneOf = (n) => n.map((x) => process.env[x]).find((v) => v && !/^TODO_/.test(v));
const SUPABASE_URL = (oneOf(['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) || '').replace(/\/+$/, '');
const SERVICE_ROLE = oneOf(['SUPABASE_SERVICE_ROLE_KEY']);
const ANON_KEY = oneOf(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY']);
const DATABASE_URL = oneOf(['DATABASE_URL_TRANSACTION', 'DATABASE_URL']);
for (const [k, v] of Object.entries({ SUPABASE_URL, SERVICE_ROLE, ANON_KEY, DATABASE_URL })) {
  if (!v) { console.error(`missing env: ${k}`); process.exit(2); }
}

const PASSWORD = process.env.BORJIE_TEST_USER_PASSWORD ?? 'BorjieTest!2026';
const ORG_COUNT = 6;
const MEMBERS = [
  { role: 'owner', roles: ['OWNER', 'owner'], isOwner: true },
  { role: 'worker', roles: ['MAINTENANCE_STAFF', 'worker', 'employee'], isOwner: false },
  { role: 'customer', roles: ['RESIDENT', 'buyer', 'customer'], isOwner: false },
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

async function upsertUser(email, roles, tenantId, first) {
  const payload = {
    email, password: PASSWORD, email_confirm: true,
    app_metadata: { tenant_id: tenantId, roles, environment: 'development' },
    user_metadata: { first_name: first, last_name: 'Test' },
  };
  const existing = await findByEmail(email);
  if (existing) {
    await adminApi(`/auth/v1/admin/users/${encodeURIComponent(existing.id)}`, { method: 'PUT', body: JSON.stringify(payload) });
    return existing.id;
  }
  const { ok, body, status } = await adminApi('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify(payload) });
  if (!ok) throw new Error(`create ${email} failed (${status}): ${JSON.stringify(body)}`);
  return body?.id ?? body?.user?.id;
}

async function verifyLogin(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  return res.ok && !!body?.access_token;
}

async function main() {
  console.log(`target: ${SUPABASE_URL}  password: ${PASSWORD}\n`);
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, idle_timeout: 2, onnotice: () => {} });
  const rows = [];
  try {
    for (let i = 1; i <= ORG_COUNT; i += 1) {
      const tenantId = `tnt_test_org_${i}`;
      const slug = `test-org-${i}`;
      // org tenant
      await sql`INSERT INTO tenants (id, name, slug, status, primary_email, country, settings, created_at, updated_at, created_by)
        VALUES (${tenantId}, ${`Test Org ${i}`}, ${slug}, 'active', ${`org${i}-owner@borjie.test`}, 'TZ',
        ${JSON.stringify({ currency: 'TZS', timezone: 'Africa/Dar_es_Salaam', dev: true })}::jsonb, NOW(), NOW(), 'seed-org-triples')
        ON CONFLICT (slug) DO NOTHING`;
      const t = await sql`SELECT id FROM tenants WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`;
      const realTenantId = t.length ? t[0].id : tenantId;

      for (const m of MEMBERS) {
        const email = `org${i}-${m.role}@borjie.test`;
        const supaId = await upsertUser(email, m.roles, realTenantId, `Org${i}${m.role}`);
        const ex = await sql`SELECT id FROM users WHERE tenant_id = ${realTenantId} AND email = ${email} AND deleted_at IS NULL LIMIT 1`;
        if (!ex.length) {
          await sql`INSERT INTO users (id, tenant_id, email, phone, first_name, last_name, status, is_owner, created_at, updated_at, created_by)
            VALUES (${`usr_${randomUUID()}`}, ${realTenantId}, ${email}, NULL, ${m.role}, ${`Org${i}`}, 'active', ${m.isOwner}, NOW(), NOW(), 'seed-org-triples')
            ON CONFLICT DO NOTHING`;
        }
        rows.push({ org: i, role: m.role, email, supaId });
        process.stdout.write(`  org${i} ${m.role.padEnd(9)} ${email}\n`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log('\nLogin verification:');
  let ok = 0;
  for (const r of rows) {
    const pass = await verifyLogin(r.email);
    if (pass) ok += 1; else console.log(`  ✗ ${r.email}`);
  }
  console.log(`\n  ${ok}/${rows.length} users logged in ✓`);
  console.log('\nOrg groupings (linked by tenant):');
  for (let i = 1; i <= ORG_COUNT; i += 1) {
    console.log(`  Org ${i} (tnt_test_org_${i}): org${i}-owner + org${i}-worker + org${i}-customer`);
  }
}

main().catch((e) => { console.error('FAILED:', e?.stack || e); process.exit(1); });
