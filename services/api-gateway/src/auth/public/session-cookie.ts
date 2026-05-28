/**
 * Public-session cookie helpers — encrypts the Supabase access/refresh
 * token pair with AES-256-GCM under `process.env.COOKIE_SECRET` and
 * emits an HttpOnly, SameSite=Lax cookie named `borjie-session`.
 *
 * The browser never reads or writes the cookie body; it only ships it
 * back on cross-origin requests so the gateway can rehydrate the
 * Supabase session and replay the access_token as
 * `Authorization: Bearer <jwt>` against JWT-protected routes.
 *
 * Why encryption and not a signed-only cookie:
 *   - The refresh_token is bearer credential. If the cookie were merely
 *     signed (JWT/HMAC) any process that read the raw cookie value
 *     could replay the refresh token against Supabase. Encrypting
 *     keeps the secret material at rest on the cookie payload.
 *   - GCM gives us authenticated encryption (confidentiality +
 *     integrity) in one primitive — no separate HMAC pass.
 *
 * Format (URL-safe base64):
 *   `v1.<iv(12 bytes)>.<ciphertext>.<auth-tag(16 bytes)>`
 *
 * Key derivation: SHA-256 of `COOKIE_SECRET` so the operator can ship
 * any-length secret material and we always get a stable 32-byte key.
 *
 * Hard requirements per CLAUDE.md:
 *   - No raw console statements — callers thread their Pino logger.
 *   - Validates env strictly; refuses to encode/decode without secret.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const SESSION_COOKIE_NAME = 'borjie-session';

/**
 * Encoded shape of the session payload before encryption. The browser
 * sees only the encrypted blob; the gateway sees this after `decode`.
 */
export interface SessionCookiePayload {
  /** Supabase access_token (JWT) — bearer for `Authorization`. */
  readonly accessToken: string;
  /** Supabase refresh_token — used to rotate via `/auth/v1/token`. */
  readonly refreshToken: string;
  /** Epoch seconds the access token expires at. */
  readonly expiresAt: number;
  /** Supabase auth user id (sub). */
  readonly userId: string;
  /** Optional — email pulled from Supabase user payload. */
  readonly email?: string;
  /** Optional — tenant id pulled from app_metadata.tenant_id. */
  readonly tenantId?: string;
}

const KEY_LENGTH = 32; // bytes — AES-256
const IV_LENGTH = 12; // bytes — GCM nonce
const TAG_LENGTH = 16; // bytes — GCM auth tag
const VERSION = 'v1';

export class SessionCookieError extends Error {
  readonly kind = 'SessionCookieError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SessionCookieError';
  }
}

/**
 * Resolve a 32-byte key from the configured secret. Throws when the
 * env var is missing so the route fails closed at request time rather
 * than silently emitting unprotected cookies.
 */
function deriveKey(): Buffer {
  const secret = process.env.COOKIE_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new SessionCookieError(
      'COOKIE_SECRET env var must be set to at least 16 chars to encrypt session cookies',
    );
  }
  return createHash('sha256').update(secret).digest().subarray(0, KEY_LENGTH);
}

/**
 * Encrypt the payload into a cookie-safe string. The output is URL-safe
 * base64 to avoid any cookie-parser ambiguity around `+`/`/`/`=`.
 */
export function encodeSessionCookie(payload: SessionCookiePayload): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    toBase64Url(iv),
    toBase64Url(ciphertext),
    toBase64Url(tag),
  ].join('.');
}

/**
 * Decrypt + parse the cookie. Returns null when the cookie is missing,
 * malformed, or fails authentication — the caller MUST treat this as
 * "no session" rather than 500-ing the request.
 */
export function decodeSessionCookie(
  raw: string | undefined | null,
): SessionCookiePayload | null {
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, ivB64, ctB64, tagB64] = parts;
  if (!ivB64 || !ctB64 || !tagB64) return null;
  try {
    const iv = fromBase64Url(ivB64);
    const ciphertext = fromBase64Url(ctB64);
    const tag = fromBase64Url(tagB64);
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) return null;
    const key = deriveKey();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString('utf8')) as SessionCookiePayload;
    if (
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      typeof parsed.userId !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    // Auth-tag mismatch / malformed JSON / wrong key — surface as "no session".
    return null;
  }
}

export interface BuildCookieHeaderOptions {
  readonly maxAgeSeconds?: number;
  /** Force the `Secure` flag on/off; defaults to NODE_ENV==='production'. */
  readonly secure?: boolean;
  readonly sameSite?: 'lax' | 'strict' | 'none';
  readonly path?: string;
  readonly domain?: string;
}

/**
 * Build the `Set-Cookie` header value for the session cookie. Defaults
 * to HttpOnly + SameSite=Lax + Secure (in production) + 7-day TTL —
 * the safe combination per OWASP "Session cookie attributes".
 */
export function buildSessionCookieHeader(
  value: string,
  opts: BuildCookieHeaderOptions = {},
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`,
    `Path=${opts.path ?? '/'}`,
    `Max-Age=${opts.maxAgeSeconds ?? 7 * 24 * 3600}`,
    'HttpOnly',
    `SameSite=${(opts.sameSite ?? 'lax').replace(/^./, (c) => c.toUpperCase())}`,
  ];
  if (opts.secure ?? process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join('; ');
}

/**
 * Build the `Set-Cookie` header that clears the session cookie. Max-Age=0
 * makes browsers drop the cookie immediately.
 */
export function buildSessionCookieClearHeader(
  opts: Pick<BuildCookieHeaderOptions, 'path' | 'domain' | 'sameSite' | 'secure'> = {},
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=${opts.path ?? '/'}`,
    'Max-Age=0',
    'HttpOnly',
    `SameSite=${(opts.sameSite ?? 'lax').replace(/^./, (c) => c.toUpperCase())}`,
  ];
  if (opts.secure ?? process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join('; ');
}

/**
 * Parse a single cookie value out of a `Cookie:` header. We avoid
 * pulling a cookie-parser package for one named cookie — the API
 * surface is too small.
 */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(';');
  for (const raw of cookies) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      const eqIdx = trimmed.indexOf('=');
      return decodeURIComponent(trimmed.slice(eqIdx + 1));
    }
  }
  return undefined;
}

// ─── Internal base64url helpers ──────────────────────────────────────

function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? 0 : 4 - (input.length % 4);
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(b64, 'base64');
}

/**
 * Constant-time compare for two strings. Used in tests and downstream
 * helpers that want to verify a stored cookie value matches a fresh
 * encode without timing-side-channel leaks.
 */
export function constantTimeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
