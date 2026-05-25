/**
 * AWS KMS envelope encryptor — production adapter contract.
 *
 * We INTENTIONALLY do not pull in `@aws-sdk/client-kms` here — that
 * would make `@borjie/compliance-pack` AWS-flavoured, blocking
 * GCP/Vault adapters. Instead, the factory accepts a `KMSClient`
 * port the caller wires from their own integration layer.
 *
 * The contract mirrors the KMS API exactly:
 *   - `generateDataKey({ keyId, encryptionContext, numberOfBytes })`
 *     → `{ Plaintext, CiphertextBlob }`
 *   - `decrypt({ keyId, ciphertextBlob, encryptionContext })`
 *     → `{ Plaintext }`
 *
 * Encryption context is passed through to KMS verbatim, so the SAME
 * context binding semantics apply: a ciphertext encrypted with one
 * context CANNOT be decrypted with a different one — KMS itself
 * enforces this server-side.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { EncryptionContextMismatchError } from '../types.js';
import type { EncryptionContext, EncryptionEnvelope } from '../types.js';
import { digestEncryptionContext } from './in-memory-adapter.js';
import type { EnvelopeEncryptor } from './port.js';

/**
 * The minimal KMS API surface we need. Implement with `@aws-sdk/client-kms`
 * in your integration layer; tests stub this directly.
 */
export interface KMSClient {
  generateDataKey(params: {
    readonly keyId: string;
    readonly encryptionContext: Readonly<Record<string, string>>;
    readonly numberOfBytes: number;
  }): Promise<{ readonly Plaintext: Buffer; readonly CiphertextBlob: Buffer }>;

  decrypt(params: {
    readonly keyId: string;
    readonly ciphertextBlob: Buffer;
    readonly encryptionContext: Readonly<Record<string, string>>;
  }): Promise<{ readonly Plaintext: Buffer }>;
}

export interface AWSKMSEncryptorOptions {
  readonly keyId: string;
  readonly region: string;
  readonly client: KMSClient;
}

function contextAsRecord(context: EncryptionContext): Readonly<Record<string, string>> {
  return Object.freeze({
    tenantId: context.tenantId,
    field: context.field,
    resource: context.resource,
  });
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function aesGcmDecrypt(key: Buffer, payload: string): Buffer {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Build a KMS-backed envelope encryptor. The KMS client must be
 * provided — we do not import the AWS SDK to keep this package
 * provider-agnostic.
 */
export function createAWSKMSEnvelopeEncryptor(
  options: AWSKMSEncryptorOptions,
): EnvelopeEncryptor {
  const { keyId, client } = options;
  return {
    getKeyId: () => keyId,

    async encrypt({ plaintext, context }): Promise<EncryptionEnvelope> {
      const { Plaintext, CiphertextBlob } = await client.generateDataKey({
        keyId,
        encryptionContext: contextAsRecord(context),
        numberOfBytes: 32,
      });
      // Use the plaintext DEK to encrypt the payload locally, then
      // forget it. The ciphertext-blob is the wrapped DEK.
      const ciphertext = aesGcmEncrypt(Plaintext, Buffer.from(plaintext, 'utf8'));
      return Object.freeze({
        ciphertext,
        wrappedDek: CiphertextBlob.toString('base64'),
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
          'decryption context does not match envelope context (pre-KMS check)',
        );
      }
      if (envelope.keyId !== keyId) {
        throw new EncryptionContextMismatchError(
          `envelope encrypted with key ${envelope.keyId}, encryptor uses ${keyId}`,
        );
      }
      const { Plaintext: dek } = await client.decrypt({
        keyId,
        ciphertextBlob: Buffer.from(envelope.wrappedDek, 'base64'),
        encryptionContext: contextAsRecord(context),
      });
      const pt = aesGcmDecrypt(dek, envelope.ciphertext);
      return pt.toString('utf8');
    },
  };
}
