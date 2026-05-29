/**
 * scripts/live-test/post-deploy-smoke.ts
 *
 * Post-deploy smoke runner — probes deployed Vercel surfaces and the
 * production api-gateway with a freshly minted test JWT.
 *
 * Steps:
 *   1. GET marketing routes (`/`, `/pricing`, `/about`, `/sign-up`, `/sign-in`).
 *   2. GET owner-web routes (`/sign-in`, `/dashboard` — expects 200 or 307).
 *   3. Mint a Supabase-style HS256 JWT against `SUPABASE_JWT_SECRET`
 *      using the owner test user (see Docs/AUDIT/TEST_USER_MATRIX.md).
 *   4. Call `GET /api/v1/owner/brief` against the deployed gateway and
 *      assert the response body has `success: true` + a non-empty `data`.
 *   5. Print PASS/FAIL per check + a final tally. Exit 0 only when every
 *      step passes.
 *
 * Usage:
 *   pnpm tsx scripts/live-test/post-deploy-smoke.ts
 *
 * Env (loaded from .env.production then .env.local):
 *   SMOKE_MARKETING_URL          required — e.g. https://borjie-marketing.vercel.app
 *   SMOKE_OWNER_URL              required — e.g. https://borjie-owner-web.vercel.app
 *   SMOKE_API_URL                required — e.g. https://api.borjie.co.tz
 *   SUPABASE_JWT_SECRET          required — same HS256 secret the gateway uses
 *   SEED_TEST_TENANT_ID          default 00000000-0000-0000-0000-000000000001
 *   SEED_TEST_OWNER_EMAIL        default owner@borjie.test
 *   SMOKE_TIMEOUT_MS             default 15000
 *
 * Exits:
 *   0  every check PASS
 *   1  one or more FAIL
 *   2  required env var missing
 */

import { SignJWT } from 'jose';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { script: 'live-test/post-deploy-smoke' },
  redact: {
    paths: ['password', 'token', 'secret', 'authorization'],
    censor: '[REDACTED]',
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Load .env.production first (operator-supplied prod values), then .env.local
// (dev fallback). Neither file is required — env vars may come from the shell.
loadDotenv({ path: path.join(REPO_ROOT, '.env.production'), override: false });
loadDotenv({ path: path.join(REPO_ROOT, '.env.local'), override: false });

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? '15000');

interface StepResult {
  readonly step: string;
  readonly status: 'PASS' | 'FAIL';
  readonly detail?: string;
}

const results: StepResult[] = [];

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    logger.error({ name }, 'Required env var is missing');
    process.exit(2);
  }
  return v;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

async function probe(
  step: string,
  url: string,
  expectStatuses: ReadonlyArray<number>,
  init: RequestInit = {},
): Promise<StepResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'manual',
    });
    const status = res.status;
    if (expectStatuses.includes(status)) {
      return { step, status: 'PASS', detail: `HTTP ${status}` };
    }
    return {
      step,
      status: 'FAIL',
      detail: `HTTP ${status} (expected one of ${expectStatuses.join(', ')})`,
    };
  } catch (err) {
    return {
      step,
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mintOwnerToken(tenantId: string, email: string): Promise<string> {
  const secret = requireEnv('SUPABASE_JWT_SECRET');
  if (secret.length < 32) {
    logger.warn(
      { length: secret.length },
      'SUPABASE_JWT_SECRET is shorter than 32 chars — gateway may reject',
    );
  }
  const enc = new TextEncoder().encode(secret);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email,
    role: 'authenticated',
    aud: 'authenticated',
    app_metadata: {
      tenant_id: tenantId,
      mining_role: 'owner',
    },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(`smoke-owner-${tenantId}`)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 15)
    .setIssuer('supabase')
    .sign(enc);
}

async function runMarketing(baseUrl: string): Promise<void> {
  const paths = ['/', '/pricing', '/about', '/sign-up', '/sign-in'] as const;
  for (const p of paths) {
    const r = await probe(`marketing GET ${p}`, `${baseUrl}${p}`, [200]);
    results.push(r);
    logger.info({ r }, `marketing ${p}`);
  }
}

async function runOwnerWeb(baseUrl: string): Promise<void> {
  const checks = [
    { path: '/sign-in', expected: [200] },
    // dashboard requires auth — middleware should redirect to /sign-in (307)
    // or render the public shell (200). Either is a healthy deploy.
    { path: '/dashboard', expected: [200, 302, 307] },
  ] as const;
  for (const c of checks) {
    const r = await probe(
      `owner-web GET ${c.path}`,
      `${baseUrl}${c.path}`,
      c.expected,
    );
    results.push(r);
    logger.info({ r }, `owner-web ${c.path}`);
  }
}

async function runOwnerBrief(apiUrl: string): Promise<void> {
  const tenantId = optionalEnv(
    'SEED_TEST_TENANT_ID',
    '00000000-0000-0000-0000-000000000001',
  );
  const email = optionalEnv('SEED_TEST_OWNER_EMAIL', 'owner@borjie.test');

  let token: string;
  try {
    token = await mintOwnerToken(tenantId, email);
  } catch (err) {
    results.push({
      step: 'owner brief — mint token',
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const url = `${apiUrl}/api/v1/owner/brief`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    if (res.status !== 200) {
      results.push({
        step: `GET ${url}`,
        status: 'FAIL',
        detail: `HTTP ${res.status}`,
      });
      return;
    }
    const json = (await res.json()) as { success?: boolean; data?: unknown };
    if (!json.success || !json.data) {
      results.push({
        step: `GET ${url}`,
        status: 'FAIL',
        detail: 'response missing success+data',
      });
      return;
    }
    results.push({
      step: `GET ${url}`,
      status: 'PASS',
      detail: 'real data returned',
    });
  } catch (err) {
    results.push({
      step: `GET ${url}`,
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const marketingUrl = requireEnv('SMOKE_MARKETING_URL').replace(/\/+$/, '');
  const ownerUrl = requireEnv('SMOKE_OWNER_URL').replace(/\/+$/, '');
  const apiUrl = requireEnv('SMOKE_API_URL').replace(/\/+$/, '');

  logger.info({ marketingUrl, ownerUrl, apiUrl }, 'starting smoke');

  await runMarketing(marketingUrl);
  await runOwnerWeb(ownerUrl);
  await runOwnerBrief(apiUrl);

  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;

  // Pretty print each result (logger-only would hide structure on TTY).
  for (const r of results) {
    const tag = r.status === 'PASS' ? 'PASS' : 'FAIL';
    process.stdout.write(`  ${tag}  ${r.step}${r.detail ? ` — ${r.detail}` : ''}\n`);
  }
  process.stdout.write(`Tally: ${pass} PASS · ${fail} FAIL\n`);

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  logger.error({ err }, 'smoke run crashed');
  process.exit(1);
});
