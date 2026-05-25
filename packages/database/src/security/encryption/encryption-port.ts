/**
 * EncryptionPort — Phase D field-level encryption-at-rest.
 *
 * Closes the production gap the audit surfaced: `data-classification.ts`
 * DECLARES `encryptAtRest: true` on ~30 PII columns (KRA PIN, NIDA,
 * MFA secrets, M-Pesa phone, document URLs, voice transcripts, …) but
 * no app-layer middleware actually encrypts/decrypts them.
 *
 * Regulatory anchors:
 *   - GDPR Art.32   — "appropriate technical measures … encryption of
 *                      personal data"
 *   - TZ PDPA s.30  — controller must implement encryption proportional
 *                      to risk
 *   - SOC 2 CC6.7   — protect data at rest with encryption
 *   - ISO 27001 A.10.1 — cryptographic controls policy
 *
 * Architecture: this is a PORT (per the hexagonal pattern that already
 * threads through `kernel-*`, `platform-*`, `session-replay-storage`).
 * Adapters live in sibling files:
 *
 *   - LibsodiumAdapter (default, XChaCha20-Poly1305 via secretbox_easy)
 *   - KmsAdapter       (AWS KMS envelope encryption — lazy-imported)
 *
 * `selectEncryptionPort(env)` in `./index.ts` picks the adapter at
 * composition-root time.
 *
 * NEVER pass plaintext PII through `console.log` / Sentry breadcrumbs.
 * Adapters MUST treat ciphertext failure paths as constant-time.
 */

import type { FieldClassification } from '../data-classification.js';

/**
 * Supported AEAD ciphers. xchacha20-poly1305 (libsodium default) is
 * preferred — 192-bit nonces make per-row random nonces collision-safe
 * at any practical insert rate. aes-256-gcm reserved for KMS adapters
 * where the underlying KMS only supports AES.
 */
export type EncryptionAlgorithm = 'xchacha20-poly1305' | 'aes-256-gcm';

/**
 * On-disk shape of an encrypted field. Persisted as a single TEXT
 * column with the JSON-serialised form:
 *
 *   {"v":1,"alg":"xchacha20-poly1305","n":"<base64-nonce>","c":"<base64-ciphertext>"}
 *
 * `keyVersion` is the master-key generation that derived the row's
 * encryption key. Rotation creates a new master generation; existing
 * rows decrypt under the older generation until the operator runs the
 * re-encryption script.
 */
export interface EncryptedBlob {
  readonly keyVersion: number;
  readonly nonce: string;
  readonly ciphertext: string;
  readonly algorithm: EncryptionAlgorithm;
}

/**
 * Sentinel prefix written to the column ahead of the JSON blob so the
 * read path can distinguish encrypted ciphertext from legacy plaintext
 * rows that pre-date the middleware. Plaintext fallback is intentional
 * — operators run `scripts/encrypt-existing-rows.mjs` to migrate
 * historical rows asynchronously.
 */
export const ENCRYPTED_BLOB_PREFIX = 'enc:v1:';

/**
 * Per-call options. `tenantId` MAY be null for platform-tier rows
 * (e.g. audit_events.actor_email) — adapters then derive against the
 * platform-default key rather than a per-tenant key.
 */
export interface EncryptArgs {
  readonly plaintext: string | Uint8Array;
  readonly classification: FieldClassification;
  readonly tenantId: string | null;
}

export interface DecryptArgs {
  readonly blob: EncryptedBlob;
  readonly classification: FieldClassification;
  readonly tenantId: string | null;
}

export interface RotateArgs {
  readonly blob: EncryptedBlob;
  readonly classification: FieldClassification;
  readonly tenantId: string | null;
}

/**
 * Encryption port. Implementations MUST:
 *
 *   - Throw a clear, non-leaking error when master key material is
 *     missing — never silently fall back to a zero key.
 *   - Use a fresh random nonce on every encrypt() call.
 *   - Treat decrypt failure as constant-time (AEAD authentication is
 *     constant-time by design — never short-circuit on length/format
 *     checks before the MAC verifies).
 *   - Be safe to share across async contexts (no per-call instance
 *     state beyond the cipher state).
 */
export interface EncryptionPort {
  /** Adapter identifier — exposed for runbook logs and `meta` rows. */
  readonly kind: 'libsodium' | 'kms' | 'noop';

  /** Current master-key generation. Bumped by operator-driven rotation. */
  readonly currentKeyVersion: number;

  encrypt(args: EncryptArgs): Promise<EncryptedBlob>;
  decrypt(args: DecryptArgs): Promise<string | Uint8Array>;
  /** Re-encrypt a blob under the current key version (no-op if already current). */
  rotate(args: RotateArgs): Promise<EncryptedBlob>;
}

/**
 * Serialise an EncryptedBlob to the on-disk TEXT form. Round-trip safe
 * with `deserializeBlob`.
 */
export function serializeBlob(blob: EncryptedBlob): string {
  const payload = JSON.stringify({
    v: blob.keyVersion,
    alg: blob.algorithm,
    n: blob.nonce,
    c: blob.ciphertext,
  });
  return `${ENCRYPTED_BLOB_PREFIX}${payload}`;
}

/**
 * Parse an on-disk TEXT cell back to an EncryptedBlob. Returns `null`
 * when the cell is plaintext (no `enc:v1:` prefix) — the read path
 * passes plaintext through unchanged so legacy rows remain readable
 * until the operator runs the re-encryption script.
 */
export function deserializeBlob(stored: string): EncryptedBlob | null {
  if (typeof stored !== 'string' || !stored.startsWith(ENCRYPTED_BLOB_PREFIX)) {
    return null;
  }
  const json = stored.slice(ENCRYPTED_BLOB_PREFIX.length);
  try {
    const parsed = JSON.parse(json) as {
      v?: unknown;
      alg?: unknown;
      n?: unknown;
      c?: unknown;
    };
    if (
      typeof parsed.v !== 'number' ||
      typeof parsed.alg !== 'string' ||
      typeof parsed.n !== 'string' ||
      typeof parsed.c !== 'string'
    ) {
      return null;
    }
    if (parsed.alg !== 'xchacha20-poly1305' && parsed.alg !== 'aes-256-gcm') {
      return null;
    }
    return {
      keyVersion: parsed.v,
      algorithm: parsed.alg,
      nonce: parsed.n,
      ciphertext: parsed.c,
    };
  } catch {
    return null;
  }
}

/**
 * Error type thrown when master-key material is missing. Surfaces at
 * adapter construction time so misconfigured services fail loudly at
 * boot rather than silently dropping PII to disk in plaintext.
 */
export class EncryptionKeyUnavailableError extends Error {
  public override readonly name = 'EncryptionKeyUnavailableError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * Error type thrown when an EncryptedBlob fails AEAD authentication
 * (tampered ciphertext, wrong tenant key, wrong generation). Never
 * exposes which check failed — generic by design.
 */
export class EncryptionAuthenticationError extends Error {
  public override readonly name = 'EncryptionAuthenticationError';
  constructor() {
    super('encryption: ciphertext authentication failed');
  }
}
