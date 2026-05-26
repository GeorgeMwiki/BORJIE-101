/**
 * AEAD cipher port — uniform interface over AES-256-GCM and
 * ChaCha20-Poly1305. Both produce a 16-byte authentication tag and use
 * a 12-byte nonce; both fail closed on tag mismatch.
 *
 * AES-256-GCM is the server default (citation NIST SP 800-38D). Mobile
 * runtimes select ChaCha20-Poly1305 (citation RFC 8439) when the host's
 * CPU lacks AES hardware. See spec §9.
 *
 * IMPORTANT: callers MUST generate a fresh nonce per ciphertext. The
 * port enforces nonce length but cannot enforce uniqueness across calls.
 */

import { gcm } from '@noble/ciphers/aes';
import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from 'node:crypto';

import { DataProtectionInvariantError } from '../types.js';

export type AeadAlgorithm = 'aes-256-gcm' | 'chacha20-poly1305';

export interface AeadCipher {
  readonly algorithm: AeadAlgorithm;
  /** Encrypt `plaintext` under `key` with `nonce` + optional `aad`. */
  encrypt(input: {
    readonly key: Uint8Array;
    readonly nonce: Uint8Array;
    readonly plaintext: Uint8Array;
    readonly aad?: Uint8Array;
  }): Uint8Array;
  /** Decrypt `ciphertext` under `key` with `nonce` + optional `aad`. */
  decrypt(input: {
    readonly key: Uint8Array;
    readonly nonce: Uint8Array;
    readonly ciphertext: Uint8Array;
    readonly aad?: Uint8Array;
  }): Uint8Array;
}

/** Key bytes for AES-256-GCM and ChaCha20-Poly1305 — both 256-bit. */
export const KEY_LENGTH = 32 as const;

/** Nonce bytes — both ciphers use 96-bit / 12-byte nonces. */
export const NONCE_LENGTH = 12 as const;

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_LENGTH) {
    throw new DataProtectionInvariantError(
      'aead.key_length',
      `AEAD key must be exactly ${KEY_LENGTH} bytes, got ${key.length}.`,
    );
  }
}

function assertNonce(nonce: Uint8Array): void {
  if (nonce.length !== NONCE_LENGTH) {
    throw new DataProtectionInvariantError(
      'aead.nonce_length',
      `AEAD nonce must be exactly ${NONCE_LENGTH} bytes, got ${nonce.length}.`,
    );
  }
}

/** Generate `len` cryptographically secure random bytes. */
export function randomBytesNode(len: number): Uint8Array {
  // node:crypto.randomBytes returns Buffer; coerce to Uint8Array for
  // a clean cross-runtime surface.
  return new Uint8Array(randomBytes(len));
}

/** Allocate a new 12-byte nonce. */
export function newNonce(): Uint8Array {
  return randomBytesNode(NONCE_LENGTH);
}

/** Allocate a new 32-byte DEK (data-encryption key). */
export function newDek(): Uint8Array {
  return randomBytesNode(KEY_LENGTH);
}

interface EncryptArgs {
  readonly key: Uint8Array;
  readonly nonce: Uint8Array;
  readonly plaintext: Uint8Array;
  readonly aad?: Uint8Array;
}

interface DecryptArgs {
  readonly key: Uint8Array;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly aad?: Uint8Array;
}

/** AES-256-GCM AEAD via @noble/ciphers. */
export const aesGcmCipher: AeadCipher = Object.freeze({
  algorithm: 'aes-256-gcm' as const,
  encrypt({ key, nonce, plaintext, aad }: EncryptArgs): Uint8Array {
    assertKey(key);
    assertNonce(nonce);
    return gcm(key, nonce, aad).encrypt(plaintext);
  },
  decrypt({ key, nonce, ciphertext, aad }: DecryptArgs): Uint8Array {
    assertKey(key);
    assertNonce(nonce);
    return gcm(key, nonce, aad).decrypt(ciphertext);
  },
});

/** ChaCha20-Poly1305 AEAD via @noble/ciphers. */
export const chachaPolyCipher: AeadCipher = Object.freeze({
  algorithm: 'chacha20-poly1305' as const,
  encrypt({ key, nonce, plaintext, aad }: EncryptArgs): Uint8Array {
    assertKey(key);
    assertNonce(nonce);
    return chacha20poly1305(key, nonce, aad).encrypt(plaintext);
  },
  decrypt({ key, nonce, ciphertext, aad }: DecryptArgs): Uint8Array {
    assertKey(key);
    assertNonce(nonce);
    return chacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  },
});

/** Resolve a cipher by algorithm tag. */
export function cipherFor(algo: AeadAlgorithm): AeadCipher {
  switch (algo) {
    case 'aes-256-gcm':
      return aesGcmCipher;
    case 'chacha20-poly1305':
      return chachaPolyCipher;
    default: {
      // Exhaustiveness — TS will narrow `algo` to `never` here.
      const _exhaustive: never = algo;
      throw new DataProtectionInvariantError(
        'aead.unknown_algorithm',
        `Unknown AEAD algorithm: ${String(_exhaustive)}.`,
      );
    }
  }
}
