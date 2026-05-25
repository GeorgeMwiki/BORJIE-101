/**
 * Envelope-encryption port — the contract every adapter implements.
 *
 * The contract is split intentionally:
 *
 *   - `encrypt({ plaintext, context }) → envelope`
 *     Produces a sealed envelope: ciphertext + wrapped DEK + key id +
 *     digest of the context. The DEK is unique per call (no caching),
 *     so two encryptions of the same plaintext under the same context
 *     yield DIFFERENT ciphertexts. This is what makes the envelope a
 *     "freshness oracle" for plaintext-equality attacks.
 *
 *   - `decrypt({ envelope, context }) → plaintext`
 *     Verifies the context digest matches BEFORE unwrapping. A wrong
 *     context throws `EncryptionContextMismatchError`. This is the
 *     property that prevents tenant A's ciphertext from being
 *     decrypted under tenant B's context.
 *
 * `getKeyId()` lets callers record which KEK protects which envelope,
 * supporting periodic rotation without eager re-encryption.
 */

import type { EncryptionContext, EncryptionEnvelope } from '../types.js';

export interface EnvelopeEncryptor {
  encrypt(params: {
    readonly plaintext: string;
    readonly context: EncryptionContext;
  }): Promise<EncryptionEnvelope>;

  decrypt(params: {
    readonly envelope: EncryptionEnvelope;
    readonly context: EncryptionContext;
  }): Promise<string>;

  getKeyId(): string;
}

/**
 * Helper — convenience wrapper to bind a `field` + `resource` once
 * per tenant, then encrypt/decrypt many values under that context.
 *
 * Common usage: `const enc = bindField(encryptor, { tenantId, field:
 * 'email', resource: 'users' }); await enc.encrypt('a@x');`.
 */
export interface FieldBoundEncryptor {
  encryptField(value: string): Promise<EncryptionEnvelope>;
  decryptField(envelope: EncryptionEnvelope): Promise<string>;
}

export function bindField(
  encryptor: EnvelopeEncryptor,
  context: EncryptionContext,
): FieldBoundEncryptor {
  return {
    encryptField: (value) => encryptor.encrypt({ plaintext: value, context }),
    decryptField: (envelope) => encryptor.decrypt({ envelope, context }),
  };
}
