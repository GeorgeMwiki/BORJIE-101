/**
 * ConnectorTokenCipher — AES-256-GCM seal/open for connector OAuth tokens
 * stored as `bytea` in `connector_credentials.access_token_enc`.
 *
 * Sibling of the calendar `token-cipher.ts`, but the connector schema binds the
 * encrypted columns to `Uint8Array` (the `bytea` custom Drizzle type) rather
 * than to an opaque string blob — so this cipher's `seal`/`open` speak
 * `Uint8Array`, matching the `CredentialCipher` port every `@borjie/connector-*`
 * package declares (`seal: (s) => Promise<Uint8Array>`,
 * `open: (b) => Promise<string>`).
 *
 * The wiring only ever calls `open` (decrypt at call time); `seal` is provided
 * for completeness + round-trip tests and for whenever the OAuth-exchange routes
 * are wired to persist real tokens.
 *
 * Key material (env ONLY — never hardcoded):
 *   - `CONNECTOR_TOKEN_KEY`    (preferred) — base64 / base64url / hex 32-byte key.
 *   - `ENCRYPTION_MASTER_KEY`  (fallback)  — the platform master key, reused via
 *                                            SHA-256 → 32-byte derived key so one
 *                                            secret can cover both.
 * Absent both, `createConnectorTokenCipher` returns `null` so the caller
 * degrades to the honest "not provisioned" path rather than ever attempting a
 * decrypt with no key.
 *
 * Wire format (the leading 12 bytes are the nonce, the next 16 the GCM tag,
 * remainder the ciphertext — a self-describing opaque blob, never plaintext):
 *   [ nonce(12) | tag(16) | ciphertext(N) ]
 *
 * Properties:
 *   - 96-bit random nonce per seal (GCM-safe at any practical write rate).
 *   - Authenticated: open() fails closed on tamper / wrong key.
 *   - Key material never logged; errors never echo plaintext or key bytes.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const NONCE_BYTES = 12; // 96-bit GCM nonce
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256

export interface ConnectorTokenCipher {
  /** Encrypt a plaintext token → opaque sealed bytes. */
  seal(plaintext: string): Promise<Uint8Array>;
  /** Decrypt sealed bytes → plaintext token. Throws on tamper / wrong key. */
  open(ciphertext: Uint8Array): Promise<string>;
}

/**
 * Thrown when sealed bytes fail to open (tampered, wrong key, malformed).
 * Generic by design — never reveals which check failed or any key/plaintext.
 */
export class ConnectorTokenDecryptError extends Error {
  public override readonly name = 'ConnectorTokenDecryptError';
  constructor() {
    super('connector token: ciphertext authentication failed');
  }
}

/**
 * Parse a 32-byte key from a base64 / base64url / hex string, or derive one
 * deterministically via SHA-256 from an arbitrary-length passphrase. Throws on
 * an empty key so a misconfiguration fails loudly at construction.
 */
function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('ConnectorTokenCipher: key must be a non-empty string');
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_BYTES * 2) {
    return Buffer.from(trimmed, 'hex');
  }
  const b64 = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = Buffer.from(b64, 'base64');
  if (decoded.length === KEY_BYTES) {
    return decoded;
  }
  // Deterministic 32-byte derivation so seals round-trip across restarts.
  return createHash('sha256').update(trimmed, 'utf8').digest();
}

/**
 * Build a cipher from a raw key string. Exported so tests can supply a
 * deterministic key without touching env state.
 */
export function createConnectorTokenCipherFromKey(
  rawKey: string,
): ConnectorTokenCipher {
  const key = parseKey(rawKey);
  return {
    async seal(plaintext: string): Promise<Uint8Array> {
      if (typeof plaintext !== 'string') {
        throw new Error('ConnectorTokenCipher.seal: plaintext must be a string');
      }
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(plaintext, 'utf8')),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return new Uint8Array(Buffer.concat([nonce, tag, ciphertext]));
    },
    async open(ciphertext: Uint8Array): Promise<string> {
      if (!(ciphertext instanceof Uint8Array)) {
        throw new ConnectorTokenDecryptError();
      }
      const buf = Buffer.from(ciphertext);
      if (buf.length <= NONCE_BYTES + TAG_BYTES) {
        throw new ConnectorTokenDecryptError();
      }
      const nonce = buf.subarray(0, NONCE_BYTES);
      const tag = buf.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
      const body = buf.subarray(NONCE_BYTES + TAG_BYTES);
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        const out = Buffer.concat([decipher.update(body), decipher.final()]);
        return out.toString('utf8');
      } catch {
        throw new ConnectorTokenDecryptError();
      }
    },
  };
}

/**
 * Composition-time factory. Reads the key from env (CONNECTOR_TOKEN_KEY, then
 * ENCRYPTION_MASTER_KEY). Returns `null` when neither is set so the caller can
 * degrade to a "connector runtime not provisioned" path — NEVER attempting a
 * decrypt with no key.
 */
export function createConnectorTokenCipher(
  env: NodeJS.ProcessEnv = process.env,
): ConnectorTokenCipher | null {
  const raw = env.CONNECTOR_TOKEN_KEY ?? env.ENCRYPTION_MASTER_KEY;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return createConnectorTokenCipherFromKey(raw);
}
