/**
 * BYOK / HYOK key-manager port.
 *
 * The package never holds raw KEK material in TypeScript. The port is
 * dependency-injected — production adapters wrap AWS KMS / Google EKM /
 * Azure CK; tests use the in-memory adapter exported below. Every
 * wrap/unwrap call carries an EncryptionContext (AAD) so a wrapped DEK
 * minted for tenant A and field F CANNOT be used to unwrap any other
 * (tenant, field) combination — context-bound envelope encryption.
 *
 * See spec §4 and `encryption_keys` table in migration 0053.
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import {
  DataProtectionInvariantError,
  type KeyKind,
} from '../types.js';
import {
  aesGcmCipher,
  KEY_LENGTH,
  NONCE_LENGTH,
  newNonce,
  randomBytesNode,
} from './aead-cipher.js';

/** Encryption context — binds a wrapped DEK to a (tenant, field, resource). */
export interface EncryptionContext {
  readonly tenantId: string;
  readonly field: string;
  readonly resource: string;
}

/** Wrapped data-encryption key — what gets stored alongside the ciphertext. */
export interface WrappedDek {
  /** Opaque reference to the KEK used (KMS ARN, alias, HYOK URL). */
  readonly keyRef: string;
  /** Algorithm under which the DEK was wrapped — currently always AES-256-GCM. */
  readonly algorithm: 'aes-256-gcm';
  /** Wrap nonce. */
  readonly nonce: Uint8Array;
  /** Wrapped DEK bytes (ciphertext of the raw DEK under the KEK). */
  readonly ciphertext: Uint8Array;
  /** Hex-encoded SHA-256 of the encryption context — for tamper-evident audit. */
  readonly contextHash: string;
}

export interface KeyManager {
  readonly kind: KeyKind;
  /** Opaque reference, e.g., ARN, KMS alias, HYOK URL. */
  readonly keyRef: string;
  /** Generate a fresh DEK and wrap it under this manager's KEK. */
  wrapDek(input: {
    readonly dek: Uint8Array;
    readonly context: EncryptionContext;
  }): Promise<WrappedDek>;
  /** Unwrap a previously wrapped DEK; throws on context mismatch. */
  unwrapDek(input: {
    readonly wrapped: WrappedDek;
    readonly context: EncryptionContext;
  }): Promise<Uint8Array>;
  /** Rotate: emit a new KEK; existing wrapped DEKs must be re-wrapped via rotation.ts. */
  rotate(): Promise<KeyManager>;
}

/** Compute the hex SHA-256 over an encryption context. */
export function digestContext(context: EncryptionContext): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        `${context.tenantId}|${context.field}|${context.resource}`,
      ),
    ),
  );
}

function aadFromContext(context: EncryptionContext): Uint8Array {
  return utf8ToBytes(
    `${context.tenantId}|${context.field}|${context.resource}`,
  );
}

/**
 * In-memory KEK manager — for tests only. Keeps the KEK in JS memory;
 * UNSAFE for production. Production adapters wrap AWS KMS / Google EKM /
 * Azure CK and never expose the raw KEK to JS.
 *
 * Sealed via `createInMemoryKeyManager(...)` so the constructor surface
 * is hidden and `kek` is a closure-local — not a property the caller
 * can introspect.
 */
export function createInMemoryKeyManager(
  options: {
    readonly kind?: KeyKind;
    readonly keyRef?: string;
    readonly kek?: Uint8Array;
  } = {},
): KeyManager {
  const kek = options.kek ?? randomBytesNode(KEY_LENGTH);
  if (kek.length !== KEY_LENGTH) {
    throw new DataProtectionInvariantError(
      'kek.key_length',
      `KEK must be ${KEY_LENGTH} bytes.`,
    );
  }
  const keyRef = options.keyRef ?? `inmem:${bytesToHex(sha256(kek)).slice(0, 16)}`;
  const kind: KeyKind = options.kind ?? 'platform-managed';

  return Object.freeze({
    kind,
    keyRef,
    async wrapDek({
      dek,
      context,
    }: {
      readonly dek: Uint8Array;
      readonly context: EncryptionContext;
    }): Promise<WrappedDek> {
      if (dek.length !== KEY_LENGTH) {
        throw new DataProtectionInvariantError(
          'dek.key_length',
          `DEK must be ${KEY_LENGTH} bytes, got ${dek.length}.`,
        );
      }
      const nonce = newNonce();
      const aad = aadFromContext(context);
      const ciphertext = aesGcmCipher.encrypt({
        key: kek,
        nonce,
        plaintext: dek,
        aad,
      });
      return Object.freeze({
        keyRef,
        algorithm: 'aes-256-gcm' as const,
        nonce,
        ciphertext,
        contextHash: digestContext(context),
      });
    },
    async unwrapDek({
      wrapped,
      context,
    }: {
      readonly wrapped: WrappedDek;
      readonly context: EncryptionContext;
    }): Promise<Uint8Array> {
      if (wrapped.keyRef !== keyRef) {
        throw new DataProtectionInvariantError(
          'kek.ref_mismatch',
          `Wrapped DEK was minted under ${wrapped.keyRef}, not ${keyRef}.`,
        );
      }
      const expectedHash = digestContext(context);
      if (expectedHash !== wrapped.contextHash) {
        throw new DataProtectionInvariantError(
          'kek.context_mismatch',
          'Encryption context does not match the wrapped DEK.',
        );
      }
      if (wrapped.nonce.length !== NONCE_LENGTH) {
        throw new DataProtectionInvariantError(
          'kek.nonce_length',
          `Wrap nonce must be ${NONCE_LENGTH} bytes.`,
        );
      }
      const aad = aadFromContext(context);
      return aesGcmCipher.decrypt({
        key: kek,
        nonce: wrapped.nonce,
        ciphertext: wrapped.ciphertext,
        aad,
      });
    },
    async rotate(): Promise<KeyManager> {
      // Mint a successor manager with a fresh KEK and a derived keyRef.
      return createInMemoryKeyManager({
        kind,
        keyRef: `${keyRef}.r1`,
      });
    },
  });
}
