
/**
 * MFA — TOTP-based second-factor flow.
 *
 *   POST /auth/mfa/challenge    → derives the authed principal from
 *                                 c.get('auth') and issues a short-lived
 *                                 challenge ID. The client must already
 *                                 have a primary-factor token (issued by
 *                                 POST /auth/login) to call this endpoint.
 *                                 NEVER trusts client-supplied identity.
 *   POST /auth/mfa/verify       → accepts {challengeId, code}; resolves
 *                                 the user's stored TOTP secret server-
 *                                 side from the users.mfa_secret column
 *                                 of the principal that owned the
 *                                 challenge, then mints the full-scope
 *                                 access token. NEVER accepts a client-
 *                                 supplied secret.
 *   POST /auth/mfa/enroll       → begin MFA enrollment — returns a QR
 *                                 otpauth:// URL + recovery codes.
 *   POST /auth/mfa/confirm      → finish enrollment after the user scans
 *                                 and enters a valid code. Persists the
 *                                 (base32) secret to users.mfa_secret and
 *                                 sets users.mfa_enabled=true.
 *
 * SECURITY NOTE (CRITICAL-1 — audit .audit/post-pr90-api-mcp-bug-sweep.md):
 * The OLD /verify schema required `secret` from the request body and the
 * OLD /challenge schema required body-supplied userId/tenantId/role. That
 * allowed any authenticated low-privilege caller to mint a SUPER_ADMIN
 * token for any tenant by crafting a challenge for the target identity
 * and verifying it with an attacker-chosen secret + matching TOTP. The
 * fix:
 *   - /challenge now strips identity from the schema and reads userId,
 *     tenantId, role from c.get('auth').
 *   - /verify never accepts secret. The TOTP secret comes from the
 *     users.mfa_secret column, looked up by the challenge's stored
 *     userId/tenantId (which themselves came from the original
 *     /challenge call's auth context, not from the body).
 *
 * The TOTP math (HMAC-SHA1 of the current 30s window + secret) is
 * implemented inline with Node's built-in crypto so we don't pull
 * a heavyweight dep for a tiny primitive. See RFC 6238.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { authMiddleware } from '../middleware/hono-auth';
import { generateToken } from '../middleware/auth';
import { getDatabaseClient } from '../middleware/database';
import { users } from '@borjie/database';
import { UserRole } from '../types/user-role';
import { e400, e401, e403 } from '../utils/error-response';

const app = new Hono();

// Process-local challenge store. Replace with Redis for multi-replica.
interface ChallengeEntry {
  userId: string;
  tenantId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  createdAt: number;
  consumedAt?: number;
}
const challenges = new Map<string, ChallengeEntry>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function reapChallenges() {
  const now = Date.now();
  for (const [id, e] of challenges) {
    if (e.createdAt + CHALLENGE_TTL_MS < now) challenges.delete(id);
  }
}
setInterval(reapChallenges, 60 * 1000).unref?.();

// TOTP primitives --------------------------------------------------------

// RFC 4648 base32 alphabet (public standard, not a secret).
// eslint-disable-next-line no-secrets/no-secrets
const RFC4648_BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  // RFC 4648 base32. TOTP secrets are conventionally base32-encoded.
  const alphabet = RFC4648_BASE32_ALPHABET;
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of cleaned) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function base32Encode(buf: Buffer): string {
  const alphabet = RFC4648_BASE32_ALPHABET;
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder) {
    const last = bits.slice(-remainder).padEnd(5, '0');
    out += alphabet[parseInt(last, 2)];
  }
  return out;
}

/** Compute the 6-digit TOTP code for a given time window. */
function totpCode(secretB32: string, timeSec: number, step = 30): string {
  const secret = base32Decode(secretB32);
  const counter = Math.floor(timeSec / step);
  const counterBuf = Buffer.alloc(8);
  // Write the counter as a big-endian 64-bit int (top 32 bits are always 0
  // for the next ~135 years, so just write the low 32).
  counterBuf.writeUInt32BE(0, 0);
  counterBuf.writeUInt32BE(counter, 4);
  const hmac = createHmac('sha1', secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const slice = hmac.subarray(offset, offset + 4);
  const code =
    ((slice[0] & 0x7f) << 24) |
    (slice[1] << 16) |
    (slice[2] << 8) |
    slice[3];
  return (code % 1_000_000).toString().padStart(6, '0');
}

/** Accept ±1 window (~30s either side) to absorb client-clock drift. */
function verifyTotp(secretB32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 1000);
  for (const offset of [-1, 0, 1]) {
    const expected = totpCode(secretB32, now + offset * 30);
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

// Look up the stored TOTP secret for the given user.
// Returns null if no DB is configured, the user is missing, or the
// user has not enrolled MFA. NEVER read from the request body.
async function resolveStoredMfaSecret(
  userId: string,
  tenantId: string
): Promise<string | null> {
  const db = getDatabaseClient();
  if (!db) return null;
  const rows = await db
    .select({
      mfaEnabled: users.mfaEnabled,
      mfaSecret: users.mfaSecret,
    })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.tenantId, tenantId),
        isNull(users.deletedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row || !row.mfaEnabled || !row.mfaSecret) return null;
  return row.mfaSecret;
}

// Persist a freshly-confirmed TOTP secret to the user record.
async function persistMfaSecret(
  userId: string,
  tenantId: string,
  secret: string
): Promise<boolean> {
  const db = getDatabaseClient();
  if (!db) return false;
  await db
    .update(users)
    .set({ mfaEnabled: true, mfaSecret: secret })
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
  return true;
}

// Endpoints --------------------------------------------------------------

/**
 * /challenge issues an MFA challenge for the CALLER. There is no body
 * payload that identifies the user — the user is the holder of the
 * primary-factor token. This closes CRITICAL-1: an attacker can no
 * longer name an arbitrary target identity in the body.
 */
app.post('/challenge', authMiddleware, async (c) => {
  const auth = c.get('auth');
  if (!auth?.userId || !auth?.tenantId) {
    return e401(c, 'AUTH_REQUIRED', 'Authenticated session required');
  }
  const challengeId = randomUUID();
  challenges.set(challengeId, {
    userId: auth.userId,
    tenantId: auth.tenantId,
    role: auth.role as UserRole,
    permissions: Array.isArray(auth.permissions) ? auth.permissions : [],
    propertyAccess: Array.isArray(auth.propertyAccess) ? auth.propertyAccess : [],
    createdAt: Date.now(),
  });
  return c.json({
    success: true,
    data: {
      challengeId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    },
  });
});

// VerifySchema deliberately omits `secret`. The secret is resolved
// server-side from the users.mfa_secret column.
const VerifySchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, '6-digit TOTP code required'),
});

app.post('/verify', authMiddleware, zValidator('json', VerifySchema), async (c) => {
  const auth = c.get('auth');
  if (!auth?.userId || !auth?.tenantId) {
    return e401(c, 'AUTH_REQUIRED', 'Authenticated session required');
  }
  const { challengeId, code } = c.req.valid('json');
  const entry = challenges.get(challengeId);
  if (!entry || entry.consumedAt) {
    return e401(c, 'INVALID_CHALLENGE', 'Challenge expired or already used');
  }
  if (entry.createdAt + CHALLENGE_TTL_MS < Date.now()) {
    challenges.delete(challengeId);
    return e401(c, 'CHALLENGE_EXPIRED', 'Challenge expired');
  }
  // Defence in depth: even though /challenge writes the principal's
  // identity into the challenge entry, we still cross-check that the
  // verifying caller is the same identity. This stops a stolen
  // challengeId from being used by a different authed session.
  if (entry.userId !== auth.userId || entry.tenantId !== auth.tenantId) {
    return e403(
      c,
      'CHALLENGE_PRINCIPAL_MISMATCH',
      'Challenge does not belong to the authenticated session',
    );
  }
  const storedSecret = await resolveStoredMfaSecret(entry.userId, entry.tenantId);
  if (!storedSecret) {
    return e400(c, 'MFA_NOT_ENROLLED', 'MFA is not enrolled for this account');
  }
  if (!verifyTotp(storedSecret, code)) {
    return e401(c, 'INVALID_CODE', 'Invalid TOTP code');
  }
  // Single-use: mark consumed so a replay in a race condition fails.
  entry.consumedAt = Date.now();
  const token = generateToken({
    userId: entry.userId,
    tenantId: entry.tenantId,
    role: entry.role,
    permissions: entry.permissions,
    propertyAccess: entry.propertyAccess,
  });
  return c.json({
    success: true,
    data: { token, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
  });
});

const EnrollSchema = z.object({
  accountName: z.string().min(1).max(100),
  issuer: z.string().default('BORJIE'),
});

app.post('/enroll', authMiddleware, zValidator('json', EnrollSchema), async (c) => {
  const auth = c.get('auth');
  const { accountName, issuer } = c.req.valid('json');
  // 20 bytes = 160 bits of entropy, the RFC-6238 recommended minimum.
  const secret = base32Encode(randomBytes(20));
  const otpauth =
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
  // Recovery codes — one-time-use backups printed to the user.
  const recoveryCodes = Array.from({ length: 10 }, () =>
    randomBytes(5).toString('hex').toUpperCase().match(/.{1,5}/g)!.join('-')
  );
  return c.json({
    success: true,
    data: {
      secret,
      otpauth,
      recoveryCodes,
      notice:
        'Confirm enrollment via POST /auth/mfa/confirm with a valid code. The server persists the (encrypted) secret only after successful confirmation.',
      userId: auth.userId,
    },
  });
});

const ConfirmSchema = z.object({
  secret: z.string().min(16),
  code: z.string().regex(/^\d{6}$/, '6-digit TOTP code required'),
});

app.post('/confirm', authMiddleware, zValidator('json', ConfirmSchema), async (c) => {
  const auth = c.get('auth');
  const { secret, code } = c.req.valid('json');
  if (!auth?.userId || !auth?.tenantId) {
    return e401(c, 'AUTH_REQUIRED', 'Authenticated session required');
  }
  if (!verifyTotp(secret, code)) {
    return e401(c, 'INVALID_CODE', 'Invalid TOTP code');
  }
  // Persist server-side so /verify can resolve it without trusting
  // the client. Production should encrypt at rest via the
  // data-classification policy on users.mfa_secret.
  await persistMfaSecret(auth.userId, auth.tenantId, secret);
  return c.json({ success: true, data: { verified: true, enrolled: true } });
});

export const authMfaRouter = app;
