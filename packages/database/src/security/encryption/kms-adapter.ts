/**
 * KMS-backed EncryptionPort (envelope encryption).
 *
 * Pattern:
 *
 *   1. On encrypt() we ask KMS to GenerateDataKey under the configured
 *      CMK alias. KMS returns a fresh 256-bit DEK in TWO forms:
 *      `Plaintext` (used to encrypt this single field) and
 *      `CiphertextBlob` (the same key encrypted under the CMK).
 *   2. We encrypt the field under the plaintext DEK with AES-256-GCM
 *      (Node built-in), zero the plaintext DEK, and persist BOTH the
 *      ciphertext and the wrapped-DEK blob alongside the field.
 *   3. On decrypt() we ask KMS to Decrypt the wrapped-DEK back to a
 *      plaintext DEK, use it once, then zero it. KMS handles CMK
 *      rotation independently — we never see the CMK material itself.
 *
 * This pattern (envelope encryption) satisfies SOC 2 CC6.7 + ISO 27001
 * A.10.1 in environments that mandate KMS-backed key material (CMK
 * rotation handled by AWS, audit trail in CloudTrail).
 *
 * When `@aws-sdk/client-kms` is not installed at runtime, the adapter
 * falls back to the libsodium adapter and emits a structured warn log
 * so operators notice the misconfiguration without crashing the boot.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import {
  EncryptionAuthenticationError,
  EncryptionKeyUnavailableError,
  type DecryptArgs,
  type EncryptArgs,
  type EncryptedBlob,
  type EncryptionPort,
  type RotateArgs,
} from './encryption-port.js';
import { createLibsodiumAdapter } from './libsodium-adapter.js';
import type { MasterKeySnapshot } from './tenant-key-derivation.js';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;

export interface KmsAdapterConfig {
  /** AWS KMS CMK ARN or alias (e.g. `alias/borjie-pii`). */
  readonly kmsKeyId: string;
  /** AWS region for the KMS client. */
  readonly region: string;
  /** Fallback when KMS init fails. Required — never run with no fallback. */
  readonly fallbackSnapshot: MasterKeySnapshot;
  /** Test seam — injects a pre-built KMS client. */
  readonly clientOverride?: KmsClientLike;
  /** Pluggable logger so api-gateway can route through Pino. */
  readonly logger?: KmsLogger;
}

export interface KmsLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
}

export interface KmsClientLike {
  send(command: unknown): Promise<unknown>;
}

interface GenerateDataKeyResult {
  Plaintext?: Uint8Array;
  CiphertextBlob?: Uint8Array;
  KeyId?: string;
}

interface DecryptResult {
  Plaintext?: Uint8Array;
}

const defaultLogger: KmsLogger = {
  // eslint-disable-next-line no-console
  info: (m, c) => console.info(`[encryption.kms] ${m}`, c ?? {}),
  // eslint-disable-next-line no-console
  warn: (m, c) => console.warn(`[encryption.kms] ${m}`, c ?? {}),
};

/**
 * Build a KMS-backed adapter. Falls back to the libsodium adapter when
 * the AWS SDK is not installed at runtime — never blocks boot.
 */
export async function createKmsAdapter(
  config: KmsAdapterConfig,
): Promise<EncryptionPort> {
  if (!config.kmsKeyId) {
    throw new EncryptionKeyUnavailableError(
      'createKmsAdapter: kmsKeyId is required',
    );
  }
  const logger = config.logger ?? defaultLogger;
  const client =
    config.clientOverride ?? (await tryBuildKmsClient(config.region, logger));

  if (!client) {
    logger.warn(
      '@aws-sdk/client-kms unavailable — falling back to libsodium adapter',
      { kmsKeyId: redactKeyId(config.kmsKeyId) },
    );
    return createLibsodiumAdapter({ snapshot: config.fallbackSnapshot });
  }

  return buildAdapter({
    client,
    kmsKeyId: config.kmsKeyId,
    logger,
    fallbackSnapshot: config.fallbackSnapshot,
  });
}

/**
 * Try to import `@aws-sdk/client-kms` and instantiate a client. Returns
 * `null` on failure so the caller can fall back gracefully.
 */
async function tryBuildKmsClient(
  region: string,
  logger: KmsLogger,
): Promise<KmsClientLike | null> {
  try {
    const moduleName = '@aws-sdk/client-kms';
    const mod = (await import(/* @vite-ignore */ moduleName)) as {
      KMSClient?: new (cfg: { region: string }) => KmsClientLike;
    };
    if (!mod.KMSClient) {
      logger.warn('KMSClient symbol missing from @aws-sdk/client-kms');
      return null;
    }
    return new mod.KMSClient({ region });
  } catch (error) {
    logger.warn('failed to load @aws-sdk/client-kms', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface BuildAdapterArgs {
  readonly client: KmsClientLike;
  readonly kmsKeyId: string;
  readonly logger: KmsLogger;
  readonly fallbackSnapshot: MasterKeySnapshot;
}

function buildAdapter(args: BuildAdapterArgs): EncryptionPort {
  const { client, kmsKeyId } = args;
  const currentKeyVersion = args.fallbackSnapshot.current.version;

  return {
    kind: 'kms',
    currentKeyVersion,
    async encrypt({ plaintext, classification, tenantId }: EncryptArgs) {
      const { plaintextDek, wrappedDek } = await generateDataKey({
        client,
        kmsKeyId,
        encryptionContext: makeContext(classification, tenantId),
      });
      try {
        const nonce = randomBytes(NONCE_BYTES);
        const cipher = createCipheriv(
          'aes-256-gcm',
          Buffer.from(plaintextDek),
          nonce,
        );
        const message =
          typeof plaintext === 'string'
            ? Buffer.from(plaintext, 'utf8')
            : Buffer.from(plaintext);
        const enc = Buffer.concat([cipher.update(message), cipher.final()]);
        const tag = cipher.getAuthTag();
        // We pack (wrappedDek-length || wrappedDek || ciphertext || tag)
        // into the ciphertext field so on-disk shape stays flat.
        const wrappedLen = Buffer.alloc(2);
        wrappedLen.writeUInt16BE(wrappedDek.length, 0);
        const combined = Buffer.concat([
          wrappedLen,
          Buffer.from(wrappedDek),
          enc,
          tag,
        ]);
        return {
          keyVersion: currentKeyVersion,
          algorithm: 'aes-256-gcm',
          nonce: Buffer.from(nonce).toString('base64'),
          ciphertext: combined.toString('base64'),
        };
      } finally {
        // Zero the plaintext DEK as soon as we are done with it.
        zeroBuffer(plaintextDek);
      }
    },
    async decrypt({ blob, classification, tenantId }: DecryptArgs) {
      if (blob.algorithm !== 'aes-256-gcm') {
        throw new EncryptionAuthenticationError();
      }
      const combined = Buffer.from(blob.ciphertext, 'base64');
      if (combined.length < 2 + TAG_BYTES) {
        throw new EncryptionAuthenticationError();
      }
      const wrappedLen = combined.readUInt16BE(0);
      const offsetCt = 2 + wrappedLen;
      if (combined.length < offsetCt + TAG_BYTES) {
        throw new EncryptionAuthenticationError();
      }
      const wrappedDek = combined.subarray(2, offsetCt);
      const ciphertext = combined.subarray(
        offsetCt,
        combined.length - TAG_BYTES,
      );
      const tag = combined.subarray(combined.length - TAG_BYTES);
      const plaintextDek = await decryptDataKey({
        client,
        wrappedDek,
        encryptionContext: makeContext(classification, tenantId),
      });
      try {
        const nonce = Buffer.from(blob.nonce, 'base64');
        const decipher = createDecipheriv(
          'aes-256-gcm',
          Buffer.from(plaintextDek),
          nonce,
        );
        decipher.setAuthTag(tag);
        const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return out.toString('utf8');
      } catch {
        throw new EncryptionAuthenticationError();
      } finally {
        zeroBuffer(plaintextDek);
      }
    },
    async rotate({ blob, classification, tenantId }: RotateArgs) {
      if (blob.keyVersion === currentKeyVersion) return blob;
      const plain = await this.decrypt({ blob, classification, tenantId });
      return this.encrypt({ plaintext: plain, classification, tenantId });
    },
  };
}

async function generateDataKey(args: {
  readonly client: KmsClientLike;
  readonly kmsKeyId: string;
  readonly encryptionContext: Record<string, string>;
}): Promise<{ plaintextDek: Uint8Array; wrappedDek: Uint8Array }> {
  // Lazy-imported command class; we can't reference it at module load.
  const moduleName = '@aws-sdk/client-kms';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(/* @vite-ignore */ moduleName);
  const cmd = new mod.GenerateDataKeyCommand({
    KeyId: args.kmsKeyId,
    KeySpec: 'AES_256',
    NumberOfBytes: DEK_BYTES,
    EncryptionContext: args.encryptionContext,
  });
  const result = (await args.client.send(cmd)) as GenerateDataKeyResult;
  if (!result.Plaintext || !result.CiphertextBlob) {
    throw new EncryptionKeyUnavailableError(
      'KMS GenerateDataKey returned no key material',
    );
  }
  return {
    plaintextDek: new Uint8Array(result.Plaintext),
    wrappedDek: new Uint8Array(result.CiphertextBlob),
  };
}

async function decryptDataKey(args: {
  readonly client: KmsClientLike;
  readonly wrappedDek: Uint8Array | Buffer;
  readonly encryptionContext: Record<string, string>;
}): Promise<Uint8Array> {
  const moduleName = '@aws-sdk/client-kms';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(/* @vite-ignore */ moduleName);
  const cmd = new mod.DecryptCommand({
    CiphertextBlob: args.wrappedDek,
    EncryptionContext: args.encryptionContext,
  });
  try {
    const result = (await args.client.send(cmd)) as DecryptResult;
    if (!result.Plaintext) {
      throw new EncryptionAuthenticationError();
    }
    return new Uint8Array(result.Plaintext);
  } catch (error) {
    if (error instanceof EncryptionAuthenticationError) throw error;
    throw new EncryptionAuthenticationError();
  }
}

/**
 * KMS EncryptionContext binds the ciphertext to the (tenant, table,
 * column) tuple. KMS treats the context as additional authenticated
 * data — Decrypt fails if the context does not match the value passed
 * at GenerateDataKey time.
 */
function makeContext(
  classification: { readonly table: string; readonly column: string },
  tenantId: string | null,
): Record<string, string> {
  return {
    'borjie:tenant': tenantId && tenantId.length > 0 ? tenantId : '_platform',
    'borjie:table': classification.table.toLowerCase(),
    'borjie:column': classification.column.toLowerCase(),
  };
}

function zeroBuffer(buf: Uint8Array): void {
  for (let i = 0; i < buf.length; i++) {
    buf[i] = 0;
  }
}

function redactKeyId(keyId: string): string {
  // Aliases are not secret, but ARNs may carry account IDs we'd rather
  // not surface in warn logs unprompted.
  if (keyId.startsWith('alias/')) return keyId;
  return `${keyId.slice(0, 12)}…`;
}
