/**
 * scripts/live-test/happy-path.ts
 *
 * Synthetic end-to-end smoke of the full Mr. Mwikila flow:
 *
 *    signup → chat → draft → edit → lock → share
 *
 * Mints two HS256 tokens against `.env` / `.env.local`:
 *   - LEGACY token (signed with `JWT_SECRET`)         for /api/v1/owner/*
 *   - SUPABASE token (signed with `SUPABASE_JWT_SECRET`) for /api/v1/brain/*
 *
 * Both tokens are minted locally — the script does NOT round-trip through
 * Supabase Auth. For the brain path to verify, the gateway must run with
 * the same `SUPABASE_JWT_SECRET` value as this script. See
 * Docs/OPS/LIVE_TEST_RUNBOOK.md "JWT secret choice".
 *
 * Exits 0 only if every step passes; prints PASS / FAIL per step and a
 * final tally line.
 *
 * Invocation:
 *   pnpm tsx scripts/live-test/happy-path.ts
 *
 * Env (loaded from .env.local then .env):
 *   API_BASE_URL                  default http://localhost:4001
 *   SEED_TEST_TENANT_ID           default 00000000-0000-0000-0000-000000000001
 *   SEED_TEST_OWNER_EMAIL         default owner@borjie.test
 *   JWT_SECRET                    required (≥32 chars)
 *   SUPABASE_JWT_SECRET           required (≥10 chars)
 */

import { SignJWT } from 'jose';
import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { pino } from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { script: 'live-test/happy-path' },
  redact: {
    paths: ['password', 'token', 'secret', 'authorization'],
    censor: '[REDACTED]',
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Load env: prefer .env.local, then .env.
loadDotenv({ path: path.join(REPO_ROOT, '.env.local') });
loadDotenv({ path: path.join(REPO_ROOT, '.env') });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Resolve the gateway URL. Order:
//   1. HAPPY_PATH_API_BASE_URL — explicit override for this script.
//   2. PORT (set by the gateway's own boot) → http://localhost:${PORT}
//   3. http://localhost:4001 (current dev default)
//
// We deliberately ignore the shared API_BASE_URL because owner-web and
// admin-web treat it as their PROXY origin, not necessarily the gateway
// bind address.
const API_BASE_URL =
  process.env.HAPPY_PATH_API_BASE_URL?.trim() ||
  (process.env.PORT?.trim() ? `http://localhost:${process.env.PORT.trim()}` : '') ||
  'http://localhost:4001';
const TENANT_ID =
  process.env.SEED_TEST_TENANT_ID?.trim() ||
  '00000000-0000-0000-0000-000000000001';
const OWNER_EMAIL =
  process.env.SEED_TEST_OWNER_EMAIL?.trim() || 'owner@borjie.test';
const JWT_SECRET = process.env.JWT_SECRET?.trim() ?? '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET?.trim() ?? '';
const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? '';

// ---------------------------------------------------------------------------
// Token minting (mirrors borjie-test-users seed shape).
// ---------------------------------------------------------------------------

async function mintLegacyToken(
  ownerUserId: string,
  ttlSeconds = 3600,
): Promise<string> {
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be ≥32 chars — populate .env.local before running.');
  }
  const secret = new TextEncoder().encode(JWT_SECRET);
  return await new SignJWT({
    sub: ownerUserId,
    userId: ownerUserId,
    tenantId: TENANT_ID,
    role: 'OWNER',
    permissions: ['owner'],
    propertyAccess: [],
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

async function mintSupabaseToken(
  ownerUserId: string,
  ownerEmail: string,
  ttlSeconds = 3600,
): Promise<string> {
  if (!SUPABASE_JWT_SECRET || SUPABASE_JWT_SECRET.length < 10) {
    throw new Error(
      'SUPABASE_JWT_SECRET must be ≥10 chars — populate .env.local before running.',
    );
  }
  const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
  return await new SignJWT({
    email: ownerEmail,
    app_metadata: {
      tenant_id: TENANT_ID,
      tenant_name: 'Demo Mining Estate Ltd',
      mining_role: 'owner',
      roles: ['owner'],
      environment: 'development' as const,
    },
    user_metadata: {
      first_name: 'Mzee Mwanaidi',
      last_name: 'Komba',
      preferred_lang: 'sw',
    },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ownerUserId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secret);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface JsonResponse<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly body: T;
  readonly responseTimeMs: number;
}

async function postJson<T = unknown>(
  url: string,
  token: string,
  body: unknown,
): Promise<JsonResponse<T>> {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const responseTimeMs = Date.now() - started;
  let parsed: unknown = null;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return {
    ok: res.ok,
    status: res.status,
    body: parsed as T,
    responseTimeMs,
  };
}

async function getJson<T = unknown>(
  url: string,
  token: string,
): Promise<JsonResponse<T>> {
  const started = Date.now();
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });
  const responseTimeMs = Date.now() - started;
  let parsed: unknown = null;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return {
    ok: res.ok,
    status: res.status,
    body: parsed as T,
    responseTimeMs,
  };
}

// ---------------------------------------------------------------------------
// Owner user-id resolution from the DB (test users seed creates these).
// ---------------------------------------------------------------------------

async function resolveOwnerUserId(): Promise<string> {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL must be set to resolve the owner user id.');
  }
  const sql = postgres(DATABASE_URL, { max: 1 });
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${OWNER_EMAIL} LIMIT 1
    `;
    if (!rows[0]?.id) {
      throw new Error(
        `Owner user not found in public.users by email ${OWNER_EMAIL}. ` +
          'Run scripts/live-test/seed-demo.ts first.',
      );
    }
    return rows[0].id;
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

interface StepResult {
  readonly name: string;
  readonly status: 'PASS' | 'FAIL' | 'SKIP';
  readonly note?: string;
  readonly httpStatus?: number;
  readonly responseTimeMs?: number;
}

const results: StepResult[] = [];

function recordPass(name: string, partial?: Partial<StepResult>): void {
  results.push({ name, status: 'PASS', ...partial });
}
function recordFail(name: string, note: string, partial?: Partial<StepResult>): void {
  results.push({ name, status: 'FAIL', note, ...partial });
}
function recordSkip(name: string, note: string): void {
  results.push({ name, status: 'SKIP', note });
}

function announce(msg: string): void {
  // eslint-disable-next-line no-console -- standalone CLI script
  console.log(msg);
}

async function main(): Promise<void> {
  announce('');
  announce('========================================================');
  announce('  Borjie live-test happy-path runner');
  announce('========================================================');
  announce(`  API base   : ${API_BASE_URL}`);
  announce(`  Tenant ID  : ${TENANT_ID}`);
  announce(`  Owner email: ${OWNER_EMAIL}`);
  announce('');

  // --- Step 0: prerequisite check ----------------------------------------
  let ownerUserId: string;
  try {
    ownerUserId = await resolveOwnerUserId();
    recordPass('00. Resolve owner user id', { note: ownerUserId });
  } catch (err) {
    recordFail(
      '00. Resolve owner user id',
      err instanceof Error ? err.message : String(err),
    );
    summarizeAndExit();
    return;
  }

  const legacyToken = await mintLegacyToken(ownerUserId);
  const supabaseToken = await mintSupabaseToken(ownerUserId, OWNER_EMAIL);

  // --- Step 1: api-gateway health (smoke prerequisite) -------------------
  try {
    const res = await getJson<{ status?: string }>(`${API_BASE_URL}/health`, legacyToken);
    if (res.ok) {
      recordPass('01. Gateway /health', {
        httpStatus: res.status,
        responseTimeMs: res.responseTimeMs,
      });
    } else {
      recordFail('01. Gateway /health', `HTTP ${res.status}`, {
        httpStatus: res.status,
      });
    }
  } catch (err) {
    recordFail(
      '01. Gateway /health',
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Step 2: brain.health (Supabase JWT path) --------------------------
  try {
    const res = await getJson<{ ok?: boolean }>(
      `${API_BASE_URL}/api/v1/brain/health`,
      supabaseToken,
    );
    // Brain may report degraded but accept the token — treat 200 OR 503
    // (config error) as auth-passed (the real failure mode under audit was
    // 401). 401/403 → fail.
    if (res.status === 401 || res.status === 403) {
      recordFail('02. Brain /health auth', `HTTP ${res.status}`, {
        httpStatus: res.status,
      });
    } else {
      recordPass('02. Brain /health auth', {
        httpStatus: res.status,
        responseTimeMs: res.responseTimeMs,
      });
    }
  } catch (err) {
    recordFail(
      '02. Brain /health auth',
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Step 3: brain.turn — draft LOI request ----------------------------
  let brainThreadId: string | null = null;
  try {
    const res = await postJson<{
      threadId?: string;
      responseText?: string;
      proposedAction?: unknown;
    }>(
      `${API_BASE_URL}/api/v1/brain/turn`,
      supabaseToken,
      {
        userText:
          'Mr. Mwikila, help me draft an LOI to ABC Off-takers for 2 tonnes of gold concentrate.',
      },
    );
    if (res.ok && res.body?.threadId) {
      brainThreadId = res.body.threadId;
      recordPass('03. Brain /turn (initial chat)', {
        httpStatus: res.status,
        responseTimeMs: res.responseTimeMs,
        note: `threadId=${brainThreadId}`,
      });
    } else {
      recordFail(
        '03. Brain /turn (initial chat)',
        `HTTP ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
        { httpStatus: res.status },
      );
    }
  } catch (err) {
    recordFail(
      '03. Brain /turn (initial chat)',
      `Network/runtime error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Step 4: free-form draft compose -----------------------------------
  let draftId: string | null = null;
  try {
    const res = await postJson<{
      success?: boolean;
      data?: { draftId?: string; draft?: { id?: string } };
    }>(
      `${API_BASE_URL}/api/v1/owner/drafts/free-form`,
      legacyToken,
      {
        intent:
          'Draft an LOI to ABC Off-takers for 2 tonnes of gold concentrate. ' +
          'Include placeholder price and FOB Dar es Salaam delivery.',
        language: 'bilingual',
        classification: 'confidential',
        targetFormat: 'md',
      },
    );
    const composedDraftId = res.body?.data?.draftId ?? res.body?.data?.draft?.id ?? null;
    if (res.ok && composedDraftId) {
      draftId = composedDraftId;
      recordPass('04. Drafter free-form compose', {
        httpStatus: res.status,
        responseTimeMs: res.responseTimeMs,
        note: `draftId=${draftId}`,
      });
    } else {
      recordFail(
        '04. Drafter free-form compose',
        `HTTP ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
        { httpStatus: res.status },
      );
    }
  } catch (err) {
    recordFail(
      '04. Drafter free-form compose',
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // --- Step 5: revise draft (price field edit) ---------------------------
  if (draftId) {
    try {
      const res = await postJson<{
        success?: boolean;
        data?: { revisionNo?: number };
      }>(
        `${API_BASE_URL}/api/v1/owner/drafts/${draftId}/revise`,
        legacyToken,
        {
          instruction: 'Set the price field to USD 95 per gram.',
        },
      );
      if (res.ok && res.body?.data?.revisionNo) {
        recordPass('05. Draft revise (price edit)', {
          httpStatus: res.status,
          responseTimeMs: res.responseTimeMs,
          note: `revisionNo=${res.body.data.revisionNo}`,
        });
      } else {
        recordFail(
          '05. Draft revise (price edit)',
          `HTTP ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
          { httpStatus: res.status },
        );
      }
    } catch (err) {
      recordFail(
        '05. Draft revise (price edit)',
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    recordSkip('05. Draft revise (price edit)', 'no draftId from step 4');
  }

  // --- Step 6: list draft revisions --------------------------------------
  let lastRevisionNo: number | null = null;
  if (draftId) {
    try {
      const res = await getJson<{
        success?: boolean;
        data?: {
          revisions?: Array<{ revisionNo: number; lockedAt?: string | null }>;
        };
      }>(`${API_BASE_URL}/api/v1/owner/drafts/${draftId}/revisions`, legacyToken);
      if (res.ok && Array.isArray(res.body?.data?.revisions)) {
        const revs = res.body.data.revisions ?? [];
        const top = revs.reduce(
          (acc, r) => (r.revisionNo > acc ? r.revisionNo : acc),
          0,
        );
        lastRevisionNo = top;
        recordPass('06. Draft revisions list', {
          httpStatus: res.status,
          responseTimeMs: res.responseTimeMs,
          note: `revisions=${revs.length}, latest=${top}`,
        });
      } else {
        recordFail(
          '06. Draft revisions list',
          `HTTP ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
          { httpStatus: res.status },
        );
      }
    } catch (err) {
      recordFail(
        '06. Draft revisions list',
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    recordSkip('06. Draft revisions list', 'no draftId');
  }

  // --- Step 7: lock the latest revision ----------------------------------
  if (draftId && lastRevisionNo !== null && lastRevisionNo > 0) {
    try {
      const res = await postJson<{
        success?: boolean;
        data?: { lockedAt?: string };
      }>(
        `${API_BASE_URL}/api/v1/owner/drafts/${draftId}/revisions/${lastRevisionNo}/lock`,
        legacyToken,
        { reason: 'live-test happy-path lock' },
      );
      if (res.ok && res.body?.data?.lockedAt) {
        recordPass('07. Draft revision lock', {
          httpStatus: res.status,
          responseTimeMs: res.responseTimeMs,
          note: `lockedAt=${res.body.data.lockedAt}`,
        });
      } else {
        recordFail(
          '07. Draft revision lock',
          `HTTP ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
          { httpStatus: res.status },
        );
      }
    } catch (err) {
      recordFail(
        '07. Draft revision lock',
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    recordSkip(
      '07. Draft revision lock',
      `missing prereq draftId=${draftId} revNo=${lastRevisionNo}`,
    );
  }

  // --- Step 8: confirm lock via lock-status -----------------------------
  if (draftId) {
    try {
      const res = await getJson<{
        success?: boolean;
        data?: { isLocked?: boolean; lockedAt?: string | null };
      }>(`${API_BASE_URL}/api/v1/owner/drafts/${draftId}/lock-status`, legacyToken);
      if (res.ok && res.body?.data?.isLocked === true) {
        recordPass('08. Lock-status confirmation', {
          httpStatus: res.status,
          responseTimeMs: res.responseTimeMs,
          note: `draft locked (lockedAt=${res.body.data.lockedAt})`,
        });
      } else {
        recordFail(
          '08. Lock-status confirmation',
          `isLocked=${res.body?.data?.isLocked} HTTP ${res.status}`,
          { httpStatus: res.status },
        );
      }
    } catch (err) {
      recordFail(
        '08. Lock-status confirmation',
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    recordSkip('08. Lock-status confirmation', 'no draftId');
  }

  // --- Step 9: share-link generation -------------------------------------
  if (draftId) {
    try {
      const res = await postJson<{
        success?: boolean;
        data?: { url?: string; token?: string; shareLink?: { url?: string; token?: string } };
      }>(`${API_BASE_URL}/api/v1/owner/share-links`, legacyToken, {
        entityType: 'draft',
        entityId: draftId,
        recipients: ['finance@abctakers.example'],
        expiresInHours: 72,
        permission: 'read',
        reason: 'live-test happy-path share',
      });
      const sharedUrl =
        res.body?.data?.url ??
        res.body?.data?.token ??
        res.body?.data?.shareLink?.url ??
        res.body?.data?.shareLink?.token ??
        null;
      if (res.ok && sharedUrl) {
        recordPass('09. Share-link generation', {
          httpStatus: res.status,
          responseTimeMs: res.responseTimeMs,
          note: `share link issued (${String(sharedUrl).slice(0, 40)}...)`,
        });
      } else {
        recordFail(
          '09. Share-link generation',
          `HTTP ${res.status} body=${JSON.stringify(res.body).slice(0, 200)}`,
          { httpStatus: res.status },
        );
      }
    } catch (err) {
      recordFail(
        '09. Share-link generation',
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    recordSkip('09. Share-link generation', 'no draftId');
  }

  summarizeAndExit();
}

function summarizeAndExit(): never {
  announce('');
  announce('========================================================');
  announce('  RESULTS');
  announce('========================================================');
  const pad = (s: string, n: number): string =>
    s.length >= n ? s : s + ' '.repeat(n - s.length);
  for (const r of results) {
    const marker =
      r.status === 'PASS' ? '[PASS]' : r.status === 'FAIL' ? '[FAIL]' : '[SKIP]';
    const t = r.responseTimeMs ? ` (${r.responseTimeMs}ms)` : '';
    const status = r.httpStatus ? ` HTTP ${r.httpStatus}` : '';
    const note = r.note ? ` — ${r.note}` : '';
    announce(`  ${marker} ${pad(r.name, 42)}${status}${t}${note}`);
  }
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  announce('');
  announce(
    `  Tally: ${passed} PASS · ${failed} FAIL · ${skipped} SKIP · ${results.length} total`,
  );
  announce('========================================================');
  announce('');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  logger.error('happy-path: unhandled error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(2);
});
