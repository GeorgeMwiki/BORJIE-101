#!/usr/bin/env node
/**
 * seed-test-users-by-type.mjs — create 6 test users PER user-type in the live
 * Supabase project, idempotently, then VERIFY each can log in.
 *
 * Types (Supabase `app_metadata.roles` → gateway UserRole, enum-key first so it
 * maps correctly under both the F6 mapper and the richer supabase middleware):
 *   owner    → OWNER
 *   admin    → ADMIN              (Borjie-internal platform admin)
 *   manager  → PROPERTY_MANAGER   (mining site/estate manager slot)
 *   employee → MAINTENANCE_STAFF  (mining field-worker slot)
 *   buyer    → RESIDENT           (marketplace buyer slot)
 *
 * Each user: auth.users row (email+password, auto-confirmed) with server-managed
 * app_metadata { tenant_id, roles, environment }, mirrored into the app `users`
 * table, then a real password-grant login is performed to prove the credential
 * works end-to-end. Idempotent: re-runs converge (find-or-update).
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

const TENANT_ID = process.env.BORJIE_DEV_TENANT_ID ?? 'tnt_dev_landlord_001';
const TENANT_SLUG = 'dev-landlord';
const PASSWORD = process.env.BORJIE_TEST_USER_PASSWORD ?? 'BorjieTest!2026';
const PER_TYPE = 6;

const TYPES = [
  { type: 'owner', roles: ['OWNER', 'owner'], isOwner: true },
  { type: 'admin', roles: ['ADMIN', 'admin'], isOwner: false },
  { type: 'manager', roles: ['PROPERTY_MANAGER', 'site_manager', 'manager'], isOwner: false },
  { type: 'employee', roles: ['MAINTENANCE_STAFF', 'employee', 'worker'], isOwner: false },
  { type: 'buyer', roles: ['RESIDENT', 'buyer'], isOwner: false },
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

async function findByEmail(email) {
  const { ok, body } = await adminApi('/auth/v1/admin/users?page=1&per_page=2000');
  if (!ok) return null;
  return (body?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function upsertUser(email, roles, first, last) {
  const payload = {
    email, password: PASSWORD, email_confirm: true,
    app_metadata: { tenant_id: TENANT_ID, roles, environment: 'development' },
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
  console.log(`target: ${SUPABASE_URL}  tenant: ${TENANT_ID}  password: ${PASSWORD}\n`);
  const all = [];
  for (const { type, roles, isOwner } of TYPES) {
    for (let n = 1; n <= PER_TYPE; n += 1) {
      const email = `${type}${n}@borjie.test`;
      const { id, existed } = await upsertUser(email, roles, type, `Test${n}`);
      all.push({ type, email, id, existed, isOwner });
      process.stdout.write(`  ${existed ? 'exists ' : 'created'} ${email}\n`);
    }
  }

  // Mirror into app `users` table (tenant-scoped, idempotent by email).
  const sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      const t = await tx`SELECT id FROM tenants WHERE slug = ${TENANT_SLUG} AND deleted_at IS NULL LIMIT 1`;
      const tenantId = t.length ? t[0].id : TENANT_ID;
      if (!t.length) {
        await tx`INSERT INTO tenants (id, name, slug, status, primary_email, country, settings, created_at, updated_at, created_by)
          VALUES (${tenantId}, 'Dev Landlord (BORJIE)', ${TENANT_SLUG}, 'active', 'owner1@borjie.test', 'TZ',
          ${JSON.stringify({ currency: 'TZS', timezone: 'Africa/Dar_es_Salaam', dev: true })}::jsonb, NOW(), NOW(), 'seed-by-type')
          ON CONFLICT (slug) DO NOTHING`;
      }
      for (const u of all) {
        const ex = await tx`SELECT id FROM users WHERE tenant_id = ${tenantId} AND email = ${u.email} AND deleted_at IS NULL LIMIT 1`;
        if (!ex.length) {
          await tx`INSERT INTO users (id, tenant_id, email, phone, first_name, last_name, status, is_owner, created_at, updated_at, created_by)
            VALUES (${`usr_${randomUUID()}`}, ${tenantId}, ${u.email}, NULL, ${u.type}, 'Test', 'active', ${u.isOwner}, NOW(), NOW(), 'seed-by-type')
            ON CONFLICT DO NOTHING`;
        }
      }
    });
    console.log('\napp users table mirrored ✓');
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Verify login for every user.
  console.log('\nLogin verification:');
  const results = {};
  for (const u of all) {
    const r = await verifyLogin(u.email);
    results[u.type] = results[u.type] ?? { ok: 0, fail: 0 };
    if (r.ok) results[u.type].ok += 1; else { results[u.type].fail += 1; console.log(`  ✗ ${u.email} (status ${r.status})`); }
  }
  console.log('\nSummary (login OK / total per type):');
  for (const { type } of TYPES) {
    const r = results[type];
    console.log(`  ${type.padEnd(9)} ${r.ok}/${r.ok + r.fail} ✓`);
  }
}

main().catch((e) => { console.error('FAILED:', e?.stack || e); process.exit(1); });
