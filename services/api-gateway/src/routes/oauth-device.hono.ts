/**
 * /api/v1/oauth/* — OAuth2 Device Authorization Grant (RFC 8628).
 *
 * Wave AGENTIC-PLATFORM. Powers the public MCP / CLI / SDK consumers
 * (Claude Code, Cursor, Windsurf, `borjie` CLI, `@borjie/api-sdk`).
 *
 * Surface (sibling-mounted under /api/v1/oauth):
 *
 *   PUBLIC (no auth)
 *     POST /oauth/device/code        — issue a device_code + user_code
 *     GET  /oauth/device/verify      — owner-facing redirect helper
 *     GET  /oauth/device/details     — owner-web reads requested scopes
 *     POST /oauth/token              — poll exchange (device-code grant)
 *     POST /oauth/revoke             — invalidate a token (no auth — needs
 *                                       the token itself to authorise)
 *
 *   OWNER-AUTH (Supabase JWT / session cookie)
 *     POST /oauth/device/approve     — owner approves the pending grant
 *     POST /oauth/device/deny        — owner denies the pending grant
 *     GET  /oauth/agent-tokens       — list active tokens for current user
 *
 * Storage: `oauth_device_codes` + `oauth_agent_tokens` (migration 0118).
 * Hashes: SHA-256(token) is stored; cleartext is returned ONCE at /token.
 * RLS: FORCE on both tables; api-gateway sets `app.current_tenant_id`
 *      via the standard `databaseMiddleware`. Public routes that touch
 *      the pending state (no tenant context yet) intentionally bypass
 *      the tenant middleware — the policy on `oauth_device_codes`
 *      tolerates `tenant_id IS NULL`.
 *
 * Rate limiting: /oauth/token is hit on a poll loop; we accept up to
 * 5 req/s per device_code via the shared `createPublicAiRateLimitMiddleware`
 * primitive (tight window, generous count) — abuse is bounded by the
 * 10-minute device_code expiry.
 *
 * Audit: every approve / deny / token-issue / token-revoke appends a
 * hash-chained row to `ai_audit_chain` via `appendOpsAuditEntry`.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { sql, and, eq, isNull } from 'drizzle-orm';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { oauthAgentTokens, oauthDeviceCodes } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { createLogger } from '../utils/logger';
import { appendOpsAuditEntry } from './ops/audit-helper';

const moduleLogger = createLogger('oauth-device');

// ============================================================================
// Constants
// ============================================================================

const DEVICE_CODE_TTL_MS = 10 * 60_000; // 10 minutes per RFC 8628 §3.5
const POLL_INTERVAL_SEC = 5; // recommended client poll cadence
const DEFAULT_VERIFY_HOST =
  process.env.BORJIE_OWNER_WEB_URL ?? 'https://owner.borjie.app';
const VERIFICATION_URI = `${DEFAULT_VERIFY_HOST.replace(/\/+$/, '')}/oauth/confirm`;
const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

// Unambiguous alphabet: drop 0/O/1/I/L per RFC 8628 §6.1 readability.
// eslint-disable-next-line no-secrets/no-secrets -- RFC 8628 user-code alphabet, not a secret.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const USER_CODE_LEN = 8;

const KNOWN_SCOPES = new Set([
  'owner:read',
  'owner:write',
  'owner:draft',
  'owner:reminders',
  'owner:share',
  'admin:read',
]);

// ============================================================================
// Helpers
// ============================================================================

/** Generate an 8-char user_code from the unambiguous alphabet. */
function generateUserCode(): string {
  const bytes = randomBytes(USER_CODE_LEN);
  let out = '';
  for (let i = 0; i < USER_CODE_LEN; i += 1) {
    out += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length];
  }
  // Insert a dash in the middle so it reads as "ABCD-EFGH".
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Generate a 256-bit access token, returned as hex. */
function generateAccessToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 of the cleartext token, hex-encoded. */
function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Sanitise scopes, dropping unknowns, deduping, preserving order. */
function normaliseScopes(scopes: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of scopes) {
    if (!KNOWN_SCOPES.has(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// ============================================================================
// Schemas
// ============================================================================

const requestCodeSchema = z.object({
  client_id: z.string().min(1).max(120),
  client_label: z.string().min(1).max(200).optional(),
  scopes: z.array(z.string().min(1).max(64)).max(20).default([]),
});

const approveSchema = z.object({
  user_code: z.string().min(1).max(20),
});

const denySchema = z.object({
  user_code: z.string().min(1).max(20),
});

const tokenSchema = z.object({
  grant_type: z.string().min(1),
  device_code: z.string().min(1).max(120),
  client_id: z.string().min(1).max(120),
});

const revokeSchema = z.object({
  token: z.string().min(1).max(256),
});

// ============================================================================
// Public sub-app — no auth (token endpoints + device-flow init)
// ============================================================================

const publicApp = new Hono();
publicApp.use('*', databaseMiddleware);

// ─── POST /oauth/device/code ────────────────────────────────────────────────
publicApp.post('/device/code', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = requestCodeSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: 'invalid_request',
        error_description: 'client_id is required; scopes must be a string array',
      },
      400,
    );
  }
  const db = c.get('db');
  if (!db) {
    return c.json(
      { error: 'server_error', error_description: 'Database not configured' },
      503,
    );
  }
  const deviceCode = randomUUID();
  const userCode = generateUserCode();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_MS);
  const scopes = normaliseScopes(parsed.data.scopes);

  await db.insert(oauthDeviceCodes).values({
    deviceCode,
    userCode,
    clientId: parsed.data.client_id,
    clientLabel: parsed.data.client_label ?? null,
    scopes: scopes as string[],
    status: 'pending',
    expiresAt,
  });

  const verificationUri = VERIFICATION_URI;
  const verificationUriComplete = `${VERIFICATION_URI}?code=${encodeURIComponent(userCode)}`;
  moduleLogger.info(
    { clientId: parsed.data.client_id, scopes },
    'oauth.device.code.issued',
  );
  return c.json(
    {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: Math.floor(DEVICE_CODE_TTL_MS / 1000),
      interval: POLL_INTERVAL_SEC,
    },
    200,
  );
});

// ─── GET /oauth/device/verify ──────────────────────────────────────────────
// Owner-facing redirect helper. The owner pastes the URL printed by the
// device into a browser; we 302-redirect to owner-web where the consent
// UI takes over.
publicApp.get('/device/verify', (c) => {
  const code = c.req.query('code');
  const target = code
    ? `${VERIFICATION_URI}?code=${encodeURIComponent(code)}`
    : VERIFICATION_URI;
  return c.redirect(target, 302);
});

// ─── GET /oauth/device/details ─────────────────────────────────────────────
// Owner-web reads the requested scopes + client label so it can render
// an honest consent prompt. Public so the consent page works before the
// owner has authenticated (auth happens at approve time).
publicApp.get('/device/details', async (c) => {
  const userCode = c.req.query('code');
  if (!userCode) {
    return c.json(
      { error: 'invalid_request', error_description: 'code query is required' },
      400,
    );
  }
  const db = c.get('db');
  if (!db) {
    return c.json(
      { error: 'server_error', error_description: 'Database not configured' },
      503,
    );
  }
  const rows = await db
    .select({
      clientId: oauthDeviceCodes.clientId,
      clientLabel: oauthDeviceCodes.clientLabel,
      scopes: oauthDeviceCodes.scopes,
      status: oauthDeviceCodes.status,
      expiresAt: oauthDeviceCodes.expiresAt,
    })
    .from(oauthDeviceCodes)
    .where(eq(oauthDeviceCodes.userCode, userCode))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json(
      { error: 'not_found', error_description: 'Unknown user_code' },
      404,
    );
  }
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    return c.json({ error: 'expired_token', error_description: 'user_code expired' }, 410);
  }
  return c.json(
    {
      client_id: row.clientId,
      client_label: row.clientLabel ?? row.clientId,
      scopes: row.scopes ?? [],
      status: row.status,
      expires_at: row.expiresAt,
    },
    200,
  );
});

// ─── POST /oauth/token ─────────────────────────────────────────────────────
publicApp.post('/token', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = tokenSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: 'invalid_request', error_description: 'grant_type, device_code, client_id required' },
      400,
    );
  }
  if (parsed.data.grant_type !== DEVICE_GRANT_TYPE) {
    return c.json(
      { error: 'unsupported_grant_type', error_description: `Only ${DEVICE_GRANT_TYPE} is supported` },
      400,
    );
  }
  const db = c.get('db');
  if (!db) {
    return c.json({ error: 'server_error', error_description: 'Database not configured' }, 503);
  }
  const rows = await db
    .select()
    .from(oauthDeviceCodes)
    .where(eq(oauthDeviceCodes.deviceCode, parsed.data.device_code))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: 'invalid_grant', error_description: 'Unknown device_code' }, 400);
  }
  if (row.clientId !== parsed.data.client_id) {
    return c.json({ error: 'invalid_client', error_description: 'client_id mismatch' }, 400);
  }
  const now = Date.now();
  // Mark expired lazily on read (cron can sweep too, but this short-circuits).
  if (row.status === 'pending' && new Date(row.expiresAt).getTime() < now) {
    await db
      .update(oauthDeviceCodes)
      .set({ status: 'expired' })
      .where(eq(oauthDeviceCodes.deviceCode, row.deviceCode));
    return c.json({ error: 'expired_token', error_description: 'device_code expired' }, 400);
  }
  if (row.status === 'pending') {
    return c.json({ error: 'authorization_pending', error_description: 'User has not approved yet' }, 400);
  }
  if (row.status === 'denied') {
    return c.json({ error: 'access_denied', error_description: 'User denied the request' }, 400);
  }
  if (row.status === 'consumed') {
    return c.json({ error: 'invalid_grant', error_description: 'device_code already used' }, 400);
  }
  if (row.status === 'expired') {
    return c.json({ error: 'expired_token', error_description: 'device_code expired' }, 400);
  }
  // status === 'approved'
  if (!row.tenantId || !row.userId) {
    moduleLogger.error({ deviceCode: row.deviceCode }, 'oauth.token: approved row missing tenant/user');
    return c.json(
      { error: 'server_error', error_description: 'Approved grant missing tenant/user binding' },
      500,
    );
  }
  const accessToken = generateAccessToken();
  const tokenHash = hashToken(accessToken);
  await db.insert(oauthAgentTokens).values({
    tokenHash,
    clientId: row.clientId,
    clientLabel: row.clientLabel ?? null,
    tenantId: row.tenantId,
    userId: row.userId,
    scopes: (row.scopes ?? []) as string[],
  });
  await db
    .update(oauthDeviceCodes)
    .set({ status: 'consumed', consumedAt: new Date() })
    .where(eq(oauthDeviceCodes.deviceCode, row.deviceCode));
  try {
    await appendOpsAuditEntry(db, {
      action: 'oauth.token.issued',
      tenantId: row.tenantId,
      turnId: row.deviceCode,
      userId: row.userId,
      details: {
        clientId: row.clientId,
        clientLabel: row.clientLabel ?? null,
        scopes: row.scopes ?? [],
      },
    });
  } catch (err) {
    moduleLogger.warn({ err }, 'oauth.token.issued: audit append failed');
  }
  return c.json(
    {
      access_token: accessToken,
      token_type: 'Bearer',
      scope: (row.scopes ?? []).join(' '),
    },
    200,
  );
});

// ─── POST /oauth/revoke ────────────────────────────────────────────────────
publicApp.post('/revoke', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = revokeSchema.safeParse(raw);
  if (!parsed.success) {
    // RFC 7009: respond 200 even on bad token to avoid token enumeration.
    return c.json({}, 200);
  }
  const db = c.get('db');
  if (!db) {
    return c.json({}, 200);
  }
  const tokenHash = hashToken(parsed.data.token);
  const matched = await db
    .select({
      id: oauthAgentTokens.id,
      tenantId: oauthAgentTokens.tenantId,
      userId: oauthAgentTokens.userId,
      clientId: oauthAgentTokens.clientId,
    })
    .from(oauthAgentTokens)
    .where(eq(oauthAgentTokens.tokenHash, tokenHash))
    .limit(1);
  const row = matched[0];
  if (row) {
    await db
      .update(oauthAgentTokens)
      .set({ revokedAt: new Date() })
      .where(eq(oauthAgentTokens.id, row.id));
    try {
      await appendOpsAuditEntry(db, {
        action: 'oauth.token.revoked',
        tenantId: row.tenantId,
        turnId: row.id,
        userId: row.userId,
        details: { clientId: row.clientId, source: 'revoke-endpoint' },
      });
    } catch (err) {
      moduleLogger.warn({ err }, 'oauth.token.revoked: audit append failed');
    }
  }
  return c.json({}, 200);
});

// ============================================================================
// Owner-auth sub-app — Supabase JWT / session cookie required
// ============================================================================

const ownerApp = new Hono();
ownerApp.use('*', authMiddleware);
ownerApp.use('*', databaseMiddleware);

// ─── POST /oauth/device/approve ────────────────────────────────────────────
ownerApp.post('/device/approve', async (c) => {
  const auth = c.get('auth') as { tenantId: string; userId: string } | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = approveSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', error_description: 'user_code required' }, 400);
  }
  const db = c.get('db');
  if (!db) {
    return c.json({ error: 'server_error' }, 503);
  }
  const rows = await db
    .select()
    .from(oauthDeviceCodes)
    .where(
      and(eq(oauthDeviceCodes.userCode, parsed.data.user_code), eq(oauthDeviceCodes.status, 'pending')),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: 'not_found', error_description: 'Unknown or non-pending user_code' }, 404);
  }
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db
      .update(oauthDeviceCodes)
      .set({ status: 'expired' })
      .where(eq(oauthDeviceCodes.deviceCode, row.deviceCode));
    return c.json({ error: 'expired_token', error_description: 'user_code expired' }, 410);
  }
  await db
    .update(oauthDeviceCodes)
    .set({
      status: 'approved',
      approvedAt: new Date(),
      tenantId: auth.tenantId,
      userId: auth.userId,
    })
    .where(eq(oauthDeviceCodes.deviceCode, row.deviceCode));
  try {
    await appendOpsAuditEntry(db, {
      action: 'oauth.device.approved',
      tenantId: auth.tenantId,
      turnId: row.deviceCode,
      userId: auth.userId,
      details: {
        clientId: row.clientId,
        clientLabel: row.clientLabel ?? null,
        scopes: row.scopes ?? [],
        userCode: row.userCode,
      },
    });
  } catch (err) {
    moduleLogger.warn({ err }, 'oauth.device.approved: audit append failed');
  }
  return c.json({ success: true, approved: true }, 200);
});

// ─── POST /oauth/device/deny ───────────────────────────────────────────────
ownerApp.post('/device/deny', async (c) => {
  const auth = c.get('auth') as { tenantId: string; userId: string } | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = denySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', error_description: 'user_code required' }, 400);
  }
  const db = c.get('db');
  if (!db) {
    return c.json({ error: 'server_error' }, 503);
  }
  const rows = await db
    .select()
    .from(oauthDeviceCodes)
    .where(
      and(eq(oauthDeviceCodes.userCode, parsed.data.user_code), eq(oauthDeviceCodes.status, 'pending')),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: 'not_found' }, 404);
  }
  await db
    .update(oauthDeviceCodes)
    .set({ status: 'denied', tenantId: auth.tenantId, userId: auth.userId })
    .where(eq(oauthDeviceCodes.deviceCode, row.deviceCode));
  try {
    await appendOpsAuditEntry(db, {
      action: 'oauth.device.denied',
      tenantId: auth.tenantId,
      turnId: row.deviceCode,
      userId: auth.userId,
      details: {
        clientId: row.clientId,
        userCode: row.userCode,
      },
    });
  } catch (err) {
    moduleLogger.warn({ err }, 'oauth.device.denied: audit append failed');
  }
  return c.json({ success: true, denied: true }, 200);
});

// ─── POST /oauth/agent-tokens/:id/revoke ───────────────────────────────────
// Owner-driven revoke from the connected-agents UI. Distinct from the
// public POST /oauth/revoke (which requires the cleartext token); this
// path is gated by Supabase auth + scoped to the caller's own tokens.
ownerApp.post('/agent-tokens/:id/revoke', async (c) => {
  const auth = c.get('auth') as { tenantId: string; userId: string } | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const id = c.req.param('id');
  if (!id) {
    return c.json({ error: 'invalid_request', error_description: 'id required' }, 400);
  }
  const db = c.get('db');
  if (!db) {
    return c.json({ error: 'server_error' }, 503);
  }
  const rows = await db
    .select({
      id: oauthAgentTokens.id,
      userId: oauthAgentTokens.userId,
      tenantId: oauthAgentTokens.tenantId,
      clientId: oauthAgentTokens.clientId,
      revokedAt: oauthAgentTokens.revokedAt,
    })
    .from(oauthAgentTokens)
    .where(eq(oauthAgentTokens.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return c.json({ error: 'not_found' }, 404);
  }
  // Defence in depth — RLS already isolates by tenant. Belt-and-braces
  // check the userId matches the caller so one user cannot revoke a
  // peer's token within the same tenant.
  if (row.userId !== auth.userId) {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (row.revokedAt) {
    return c.json({ success: true, alreadyRevoked: true }, 200);
  }
  await db
    .update(oauthAgentTokens)
    .set({ revokedAt: new Date() })
    .where(eq(oauthAgentTokens.id, id));
  try {
    await appendOpsAuditEntry(db, {
      action: 'oauth.token.revoked',
      tenantId: row.tenantId,
      turnId: row.id,
      userId: row.userId,
      details: { clientId: row.clientId, source: 'owner-ui' },
    });
  } catch (err) {
    moduleLogger.warn({ err }, 'oauth.token.revoked: audit append failed (owner-ui)');
  }
  return c.json({ success: true }, 200);
});

// ─── GET /oauth/agent-tokens ───────────────────────────────────────────────
// Lists ACTIVE (non-revoked) tokens for the current authenticated user.
ownerApp.get('/agent-tokens', async (c) => {
  const auth = c.get('auth') as { tenantId: string; userId: string } | undefined;
  if (!auth?.tenantId || !auth?.userId) {
    return c.json({ error: 'unauthenticated' }, 401);
  }
  const db = c.get('db');
  if (!db) {
    return c.json({ success: true, data: [] }, 200);
  }
  const rows = await db
    .select({
      id: oauthAgentTokens.id,
      clientId: oauthAgentTokens.clientId,
      clientLabel: oauthAgentTokens.clientLabel,
      scopes: oauthAgentTokens.scopes,
      issuedAt: oauthAgentTokens.issuedAt,
      lastUsedAt: oauthAgentTokens.lastUsedAt,
      expiresAt: oauthAgentTokens.expiresAt,
    })
    .from(oauthAgentTokens)
    .where(
      and(
        eq(oauthAgentTokens.userId, auth.userId),
        isNull(oauthAgentTokens.revokedAt),
      ),
    );
  return c.json({ success: true, data: rows }, 200);
});

// ============================================================================
// Composite — sibling-mounted under /api/v1/oauth
// ============================================================================

const app = new Hono();
app.route('/', publicApp);
app.route('/', ownerApp);

export const oauthDeviceRouter = app;
export default app;
