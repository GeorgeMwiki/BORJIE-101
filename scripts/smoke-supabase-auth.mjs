#!/usr/bin/env node
/**
 * smoke-supabase-auth.mjs — log in as the dev owner against the live
 * BORJIE Supabase, then run the issued JWT through the production
 * `verifySupabaseJwt` helper via the JWKS path.
 *
 * Exit 0 ⇒ JWKS verification matches the api-gateway runtime path and
 * the projected principal carries the expected tenant_id + roles.
 *
 * Reads SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from .env.local
 * (already in gitignore). Designed for `node scripts/smoke-supabase-auth.mjs`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySupabaseJwt } from '../packages/ai-copilot/dist/config/supabase-auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnvLocal() {
  const file = path.join(__dirname, '..', '.env.local');
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
}
loadDotEnvLocal();

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.SMOKE_EMAIL || 'owner@borjie.dev';
const PASSWORD = process.env.SMOKE_PASSWORD || 'DevPass!Secure-2026';

if (!SUPABASE_URL || !ANON) {
  console.error('missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}

const loginRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!loginRes.ok) {
  console.error(`login failed (${loginRes.status}):`, await loginRes.text());
  process.exit(1);
}
const { access_token } = await loginRes.json();
console.log(`[smoke] login ok — access_token chars=${access_token.length}`);

const jwksUrl = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
console.log(`[smoke] verifying via JWKS at ${jwksUrl}`);

const principal = await verifySupabaseJwt(access_token, { jwksUrl });
console.log('[smoke] verifySupabaseJwt OK');
console.log('       userId    =', principal.userId);
console.log('       email     =', principal.email);
console.log('       tenantId  =', principal.tenantId);
console.log('       roles     =', principal.roles);
console.log('       env       =', principal.environment);

if (principal.tenantId !== 'tnt_dev_landlord_001') {
  console.error('[smoke] FAIL — unexpected tenant_id');
  process.exit(1);
}
if (!principal.roles.includes('OWNER')) {
  console.error('[smoke] FAIL — OWNER role missing');
  process.exit(1);
}
console.log('[smoke] all assertions passed ✓');
