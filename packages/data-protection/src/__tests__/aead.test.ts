/**
 * AEAD round-trip — real @noble/ciphers primitives.
 *
 * Live: no mock cipher, no synthetic ciphertext. Each test exercises
 * the actual AES-256-GCM and ChaCha20-Poly1305 paths.
 */

import { describe, expect, it } from 'vitest';

import {
  aesGcmCipher,
  chachaPolyCipher,
  cipherFor,
  KEY_LENGTH,
  NONCE_LENGTH,
  newDek,
  newNonce,
} from '../encrypt/aead-cipher.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('encrypt/aead-cipher', () => {
  it('AES-256-GCM round-trips bytes with no AAD', () => {
    const key = newDek();
    const nonce = newNonce();
    const plaintext = utf8('hello, mining-tz tenant');
    const ct = aesGcmCipher.encrypt({ key, nonce, plaintext });
    expect(ct.length).toBeGreaterThan(plaintext.length); // includes tag
    const pt = aesGcmCipher.decrypt({ key, nonce, ciphertext: ct });
    expect(fromUtf8(pt)).toBe('hello, mining-tz tenant');
  });

  it('AES-256-GCM honours AAD — tag fails on AAD mismatch', () => {
    const key = newDek();
    const nonce = newNonce();
    const plaintext = utf8('payload');
    const ct = aesGcmCipher.encrypt({
      key,
      nonce,
      plaintext,
      aad: utf8('aad-A'),
    });
    expect(() =>
      aesGcmCipher.decrypt({
        key,
        nonce,
        ciphertext: ct,
        aad: utf8('aad-B'),
      }),
    ).toThrow();
  });

  it('ChaCha20-Poly1305 round-trips bytes', () => {
    const key = newDek();
    const nonce = newNonce();
    const plaintext = utf8('chacha20-poly1305 path');
    const ct = chachaPolyCipher.encrypt({ key, nonce, plaintext });
    const pt = chachaPolyCipher.decrypt({ key, nonce, ciphertext: ct });
    expect(fromUtf8(pt)).toBe('chacha20-poly1305 path');
  });

  it('rejects wrong-length keys', () => {
    expect(() =>
      aesGcmCipher.encrypt({
        key: new Uint8Array(KEY_LENGTH - 1),
        nonce: newNonce(),
        plaintext: utf8('x'),
      }),
    ).toThrow(/key must be exactly 32/i);
  });

  it('rejects wrong-length nonces', () => {
    expect(() =>
      aesGcmCipher.encrypt({
        key: newDek(),
        nonce: new Uint8Array(NONCE_LENGTH - 1),
        plaintext: utf8('x'),
      }),
    ).toThrow(/nonce must be exactly 12/i);
  });

  it('cipherFor dispatches by algorithm tag', () => {
    expect(cipherFor('aes-256-gcm').algorithm).toBe('aes-256-gcm');
    expect(cipherFor('chacha20-poly1305').algorithm).toBe('chacha20-poly1305');
  });
});
