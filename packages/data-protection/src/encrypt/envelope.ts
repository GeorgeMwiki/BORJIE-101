/**
 * Envelope encryption — DEK per row, KEK in the key-manager.
 *
 * Pattern:
 *   1. Generate a fresh DEK per row (32 bytes).
 *   2. AEAD-encrypt the payload under the DEK with a fresh 12-byte
 *      nonce; bind the AAD to the EncryptionContext.
 *   3. Wrap the DEK via the KeyManager port (which dispatches to KMS /
 *      EKM / HYOK).
 *   4. Persist `{ algorithm, nonce, ciphertext, wrappedDek }` alongside
 *      the row.
 *
 * Decrypt reverses the steps: unwrap the DEK with the same context,
 * then AEAD-decrypt with the stored nonce.
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { DataProtectionInvariantError } from '../types.js';
import {
  aesGcmCipher,
  cipherFor,
  KEY_LENGTH,
  NONCE_LENGTH,
  newDek,
  newNonce,
  type AeadAlgorithm,
} from './aead-cipher.js';
import {
  type EncryptionContext,
  type KeyManager,
  type WrappedDek,
} from './key-manager.js';

export interface EnvelopeBlob {
  /** AEAD algorithm used for the payload. */
  readonly algorithm: AeadAlgorithm;
  /** Payload nonce — 12 bytes. */
  readonly nonce: Uint8Array;
  /** Payload ciphertext (includes the 16-byte auth tag from AEAD). */
  readonly ciphertext: Uint8Array;
  /** Wrapped DEK + KEK reference. */
  readonly wrappedDek: WrappedDek;
  /** Hex SHA-256 over (algorithm, contextHash, nonce, ciphertext) — tamper-evident. */
  readonly integrityHash: string;
}

function integrityHashOf(input: {
  readonly algorithm: AeadAlgorithm;
  readonly contextHash: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}): string {
  const buf = new Uint8Array(
    input.algorithm.length +
      1 +
      input.contextHash.length +
      1 +
      input.nonce.length +
      1 +
      input.ciphertext.length,
  );
  let offset = 0;
  const algoBytes = utf8ToBytes(input.algorithm);
  buf.set(algoBytes, offset);
  offset += algoBytes.length;
  buf[offset++] = 0x7c; // '|'
  const ctxBytes = utf8ToBytes(input.contextHash);
  buf.set(ctxBytes, offset);
  offset += ctxBytes.length;
  buf[offset++] = 0x7c;
  buf.set(input.nonce, offset);
  offset += input.nonce.length;
  buf[offset++] = 0x7c;
  buf.set(input.ciphertext, offset);
  return bytesToHex(sha256(buf));
}

export async function encryptEnvelope(input: {
  readonly keyManager: KeyManager;
  readonly context: EncryptionContext;
  readonly plaintext: Uint8Array;
  readonly algorithm?: AeadAlgorithm;
}): Promise<EnvelopeBlob> {
  const algorithm: AeadAlgorithm = input.algorithm ?? 'aes-256-gcm';
  const cipher = cipherFor(algorithm);
  const dek = newDek();
  const nonce = newNonce();
  const aad = utf8ToBytes(
    `${input.context.tenantId}|${input.context.field}|${input.context.resource}`,
  );
  const ciphertext = cipher.encrypt({
    key: dek,
    nonce,
    plaintext: input.plaintext,
    aad,
  });
  const wrappedDek = await input.keyManager.wrapDek({
    dek,
    context: input.context,
  });
  // Zero the DEK from this scope. (JS cannot enforce zeroisation;
  // best-effort — the GC may still hold a copy.)
  dek.fill(0);
  return Object.freeze({
    algorithm,
    nonce,
    ciphertext,
    wrappedDek,
    integrityHash: integrityHashOf({
      algorithm,
      contextHash: wrappedDek.contextHash,
      nonce,
      ciphertext,
    }),
  });
}

export async function decryptEnvelope(input: {
  readonly keyManager: KeyManager;
  readonly context: EncryptionContext;
  readonly blob: EnvelopeBlob;
}): Promise<Uint8Array> {
  const { blob, context, keyManager } = input;
  const expected = integrityHashOf({
    algorithm: blob.algorithm,
    contextHash: blob.wrappedDek.contextHash,
    nonce: blob.nonce,
    ciphertext: blob.ciphertext,
  });
  if (expected !== blob.integrityHash) {
    throw new DataProtectionInvariantError(
      'envelope.integrity_mismatch',
      'Envelope integrity hash does not match. The blob is tampered or corrupted.',
    );
  }
  if (blob.nonce.length !== NONCE_LENGTH) {
    throw new DataProtectionInvariantError(
      'envelope.nonce_length',
      `Payload nonce must be ${NONCE_LENGTH} bytes.`,
    );
  }
  const dek = await keyManager.unwrapDek({
    wrapped: blob.wrappedDek,
    context,
  });
  if (dek.length !== KEY_LENGTH) {
    throw new DataProtectionInvariantError(
      'envelope.dek_length',
      `Unwrapped DEK must be ${KEY_LENGTH} bytes.`,
    );
  }
  try {
    const aad = utf8ToBytes(
      `${context.tenantId}|${context.field}|${context.resource}`,
    );
    return cipherFor(blob.algorithm).decrypt({
      key: dek,
      nonce: blob.nonce,
      ciphertext: blob.ciphertext,
      aad,
    });
  } finally {
    dek.fill(0);
  }
}

/** Crypto-shred: discard the wrapped DEK so the ciphertext becomes unreadable. */
export function cryptoShred(blob: EnvelopeBlob): EnvelopeBlob {
  const zeroed = new Uint8Array(blob.wrappedDek.ciphertext.length);
  const nonceZ = new Uint8Array(blob.wrappedDek.nonce.length);
  return Object.freeze({
    ...blob,
    wrappedDek: Object.freeze({
      ...blob.wrappedDek,
      nonce: nonceZ,
      ciphertext: zeroed,
    }),
  });
}

// Touch the import so noUnusedLocals doesn't flag the helper.
void aesGcmCipher;
