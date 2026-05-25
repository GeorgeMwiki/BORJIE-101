/**
 * In-memory envelope encryptor — testing adapter.
 *
 * UNSAFE for production:
 *   - The wrapping key (KEK) lives in process memory; nothing
 *     protects it from a heap dump.
 *   - There is no HSM, no key rotation, no audit log.
 *
 * It IS safe for unit tests because it satisfies the same contract as
 * the AWS KMS adapter: the encryption-context binding is enforced
 * exactly the same way, so tests that pass here will pass against
 * KMS.
 *
 * Implementation uses AES-256-GCM. The "wrapping" of the DEK is a
 * second AES-256-GCM encryption with the KEK; in KMS this would be a
 * `kms:Encrypt` call.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { EncryptionContextMismatchError } from '../types.js';
import type { EncryptionContext, EncryptionEnvelope } from '../types.js';
import type { EnvelopeEncryptor } from './port.js';

const ALGORITHM = 'aes-256-gcm' as const;
const KEY_LEN = 32;
const IV_LEN = 12;

/**
 * Compute the digest used to bind a context to an envelope.
 *
 * SHA-256 of `tenantId|field|resource` — short, deterministic, and
 * collision-resistant for the relatively small space of contexts.
 */
export function digestEncryptionContext(context: EncryptionContext): string {
  const h = createHash('sha256');
  h.update(context.tenantId);
  h.update('|');
  h.update(context.field);
  h.update('|');
  h.update(context.resource);
  return h.digest('hex');
}

function aadFromContext(context: EncryptionContext): Buffer {
  return Buffer.from(
    `${context.tenantId}|${context.field}|${context.resource}`,
    'utf8',
  );
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad?: Buffer): {
  readonly ciphertext: string;
} {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(aad);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv || tag || ciphertext (base64).
  return {
    ciphertext: Buffer.concat([iv, tag, enc]).toString('base64'),
  };
}

function aesGcmDecrypt(key: Buffer, payload: string, aad?: Buffer): Buffer {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const ct = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export interface InMemoryEncryptorOptions {
  readonly keyId?: string;
  /** Provide your own KEK (32 bytes). Useful for cross-process tests. */
  readonly kek?: Buffer;
}

/**
 * Create an in-memory envelope encryptor. The KEK is generated
 * fresh per encryptor instance unless `kek` is supplied.
 */
export function createInMemoryEnvelopeEncryptor(
  options: InMemoryEncryptorOptions = {},
): EnvelopeEncryptor {
  const kek = options.kek ?? randomBytes(KEY_LEN);
  if (kek.length !== KEY_LEN) {
    throw new Error(`KEK must be exactly ${KEY_LEN} bytes (was ${kek.length})`);
  }
  const keyId = options.keyId ?? `inmem_${Date.now().toString(36)}`;

  return {
    getKeyId: () => keyId,

    async encrypt({ plaintext, context }): Promise<EncryptionEnvelope> {
      const dek = randomBytes(KEY_LEN);
      const aad = aadFromContext(context);

      const { ciphertext } = aesGcmEncrypt(dek, Buffer.from(plaintext, 'utf8'), aad);
      const wrapped = aesGcmEncrypt(kek, dek);
      return Object.freeze({
        ciphertext,
        wrappedDek: wrapped.ciphertext,
        keyId,
        contextDigest: digestEncryptionContext(context),
        algorithm: 'AES-256-GCM',
        createdAt: new Date().toISOString(),
      });
    },

    async decrypt({ envelope, context }): Promise<string> {
      const expected = digestEncryptionContext(context);
      if (envelope.contextDigest !== expected) {
        throw new EncryptionContextMismatchError(
          `decryption context does not match envelope context — ` +
            `expected digest ${expected.substring(0, 8)}…, got ${envelope.contextDigest.substring(0, 8)}…`,
        );
      }
      if (envelope.keyId !== keyId) {
        throw new EncryptionContextMismatchError(
          `envelope was encrypted with key ${envelope.keyId} but this ` +
            `encryptor holds ${keyId}`,
        );
      }
      const dek = aesGcmDecrypt(kek, envelope.wrappedDek);
      const aad = aadFromContext(context);
      const pt = aesGcmDecrypt(dek, envelope.ciphertext, aad);
      return pt.toString('utf8');
    },
  };
}
