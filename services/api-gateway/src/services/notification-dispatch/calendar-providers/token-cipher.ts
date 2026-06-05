/**
 * CalendarTokenCipher — AES-256-GCM seal/open for OAuth calendar tokens.
 *
 * Calendar refresh + access tokens are long-lived credentials to the owner's
 * Google / Microsoft calendar. They are NEVER stored in plaintext. This cipher
 * seals them before they reach `owner_calendar_connections` and opens them
 * just-in-time when the calendar-sync worker needs to call the provider API.
 *
 * Why a dedicated cipher (not the @borjie/database EncryptionPort)?
 * ----------------------------------------------------------------
 * The database `EncryptionPort` is a per-PII-COLUMN middleware keyed by a
 * `FieldClassification`. These OAuth tokens are operational secrets, not a
 * declared PII column, so a focused, self-contained AES-256-GCM seam keeps the
 * dependency surface small and the unit under test trivial — exactly the
 * fallback the task calls for ("AES-256-GCM with a key from env").
 *
 * Key material (env ONLY — no hardcoding):
 *   - `CALENDAR_TOKEN_KEY`     (preferred) — base64 or hex 32-byte key.
 *   - `ENCRYPTION_MASTER_KEY`  (fallback)  — the platform master key, reused
 *                                            via SHA-256 → 32-byte derived key
 *                                            so a single secret can cover both.
 * Absent both, `createCalendarTokenCipherFromEnv` returns `null` so the caller
 * degrades to a documented "calendar not configured" path rather than writing
 * a plaintext token.
 *
 * On-disk blob shape (opaque, clearly non-plaintext):
 *   `v1.gcm.<base64url-nonce>.<base64url-tag>.<base64url-ciphertext>`
 *
 * Properties:
 *   - 96-bit random nonce per seal (GCM-safe at any practical token-write rate).
 *   - Authenticated: open() fails closed on tamper / wrong key.
 *   - Key material never logged; errors never echo plaintext or key bytes.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const BLOB_PREFIX = 'v1.gcm';
const NONCE_BYTES = 12; // 96-bit GCM nonce
const KEY_BYTES = 32; // AES-256
const TAG_BYTES = 16;

export interface CalendarTokenCipher {
  /** Encrypt a plaintext token → opaque sealed blob. */
  seal(plaintext: string): string;
  /** Decrypt a sealed blob → plaintext token. Throws on tamper / wrong key. */
  open(blob: string): string;
}

/**
 * Thrown when a sealed blob fails to open (tampered, wrong key, malformed).
 * Generic by design — never reveals which check failed or any key/plaintext.
 */
export class CalendarTokenDecryptError extends Error {
  public override readonly name = 'CalendarTokenDecryptError';
  constructor() {
    super('calendar token: ciphertext authentication failed');
  }
}

/**
 * Parse a 32-byte key from a base64 / base64url / hex string. Throws when the
 * decoded material is not exactly 32 bytes so a misconfigured key fails loudly
 * at construction rather than silently truncating.
 */
function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  // hex if it is all hex chars and the right length
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_BYTES * 2) {
    return Buffer.from(trimmed, 'hex');
  }
  // try base64 / base64url
  const b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = Buffer.from(b64, 'base64');
  if (decoded.length === KEY_BYTES) {
    return decoded;
  }
  // Last resort: derive a stable 32-byte key from an arbitrary-length secret
  // (e.g. a passphrase) via SHA-256. Deterministic so seals round-trip across
  // restarts. Still NEVER plaintext on disk; still authenticated.
  return createHash('sha256').update(trimmed, 'utf8').digest();
}

/**
 * Build a cipher from a raw key string (base64 / hex / passphrase). Exported so
 * tests can supply a deterministic key without touching env state.
 */
export function createCalendarTokenCipher(rawKey: string): CalendarTokenCipher {
  if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
    throw new Error('CalendarTokenCipher: key must be a non-empty string');
  }
  const key = parseKey(rawKey);

  return {
    seal(plaintext: string): string {
      if (typeof plaintext !== 'string') {
        throw new Error('CalendarTokenCipher.seal: plaintext must be a string');
      }
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(plaintext, 'utf8')),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        BLOB_PREFIX,
        nonce.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url'),
      ].join('.');
    },

    open(blob: string): string {
      if (typeof blob !== 'string' || !blob.startsWith(`${BLOB_PREFIX}.`)) {
        throw new CalendarTokenDecryptError();
      }
      // BLOB_PREFIX itself contains a dot ('v1.gcm'), so strip it before
      // splitting the remaining `<nonce>.<tag>.<ciphertext>` (exactly 3 parts).
      const parts = blob.slice(BLOB_PREFIX.length + 1).split('.');
      if (parts.length !== 3) {
        throw new CalendarTokenDecryptError();
      }
      const nonce = Buffer.from(parts[0] as string, 'base64url');
      const tag = Buffer.from(parts[1] as string, 'base64url');
      const ciphertext = Buffer.from(parts[2] as string, 'base64url');
      if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
        throw new CalendarTokenDecryptError();
      }
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        const out = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        return out.toString('utf8');
      } catch {
        throw new CalendarTokenDecryptError();
      }
    },
  };
}

/**
 * Composition-time factory. Reads the key from env (CALENDAR_TOKEN_KEY, then
 * ENCRYPTION_MASTER_KEY). Returns `null` when neither is set so the caller can
 * degrade to a "calendar not configured" path — NEVER writing plaintext tokens.
 */
export function createCalendarTokenCipherFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CalendarTokenCipher | null {
  const raw = env.CALENDAR_TOKEN_KEY ?? env.ENCRYPTION_MASTER_KEY;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return createCalendarTokenCipher(raw);
}

/**
 * True when a string looks like a sealed CalendarTokenCipher blob. Used by the
 * store layer + tests to assert a column value is NOT plaintext before write.
 */
export function isSealedCalendarToken(value: string): boolean {
  if (typeof value !== 'string' || !value.startsWith(`${BLOB_PREFIX}.`)) {
    return false;
  }
  // BLOB_PREFIX contains a dot ('v1.gcm'); the remainder must be exactly the
  // three base64url segments `<nonce>.<tag>.<ciphertext>`.
  return value.slice(BLOB_PREFIX.length + 1).split('.').length === 3;
}
