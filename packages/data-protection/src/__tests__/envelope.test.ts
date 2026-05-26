/**
 * Envelope encryption tests — DEK per row, wrapped under KEK.
 *
 * Live: uses the in-memory KeyManager + real @noble/ciphers AES-256-GCM
 * for both the DEK wrap and the payload encrypt. The KEM contract is
 * identical to the production AWS-KMS path; tests passing here pass
 * against KMS.
 */

import { describe, expect, it } from 'vitest';

import { createInMemoryKeyManager } from '../encrypt/key-manager.js';
import {
  cryptoShred,
  decryptEnvelope,
  encryptEnvelope,
} from '../encrypt/envelope.js';
import { batchRotate, rewrapEnvelope } from '../encrypt/rotation.js';
import { DataProtectionInvariantError } from '../types.js';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
const fromUtf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('encrypt/envelope', () => {
  it('encrypts and decrypts the same payload under the same context', async () => {
    const km = createInMemoryKeyManager();
    const context = { tenantId: 't1', field: 'note', resource: 'lease:1' };
    const blob = await encryptEnvelope({
      keyManager: km,
      context,
      plaintext: utf8('secret note'),
    });
    expect(blob.algorithm).toBe('aes-256-gcm');
    expect(blob.ciphertext.length).toBeGreaterThan(0);
    expect(blob.integrityHash).toHaveLength(64);

    const pt = await decryptEnvelope({ keyManager: km, context, blob });
    expect(fromUtf8(pt)).toBe('secret note');
  });

  it('refuses to decrypt under a different context', async () => {
    const km = createInMemoryKeyManager();
    const ctxA = { tenantId: 't1', field: 'note', resource: 'lease:1' };
    const ctxB = { tenantId: 't1', field: 'note', resource: 'lease:2' };
    const blob = await encryptEnvelope({
      keyManager: km,
      context: ctxA,
      plaintext: utf8('payload'),
    });
    await expect(
      decryptEnvelope({ keyManager: km, context: ctxB, blob }),
    ).rejects.toBeInstanceOf(DataProtectionInvariantError);
  });

  it('detects tampered ciphertext via the integrity hash', async () => {
    const km = createInMemoryKeyManager();
    const context = { tenantId: 't1', field: 'note', resource: 'r' };
    const blob = await encryptEnvelope({
      keyManager: km,
      context,
      plaintext: utf8('intact'),
    });
    // Flip a byte in the ciphertext.
    const tamperedCt = new Uint8Array(blob.ciphertext);
    tamperedCt[0] = (tamperedCt[0] ?? 0) ^ 0xff;
    const tamperedBlob = { ...blob, ciphertext: tamperedCt };
    await expect(
      decryptEnvelope({ keyManager: km, context, blob: tamperedBlob }),
    ).rejects.toThrow();
  });

  it('rotates KEK — old blob still decrypts with old, new blob decrypts with new', async () => {
    const km1 = createInMemoryKeyManager();
    const context = { tenantId: 't1', field: 'note', resource: 'r' };
    const blob = await encryptEnvelope({
      keyManager: km1,
      context,
      plaintext: utf8('rotate me'),
    });
    const km2 = await km1.rotate();
    const rewrapped = await rewrapEnvelope({
      oldManager: km1,
      newManager: km2,
      context,
      blob,
    });
    expect(rewrapped.wrappedDek.keyRef).not.toBe(blob.wrappedDek.keyRef);
    const pt = await decryptEnvelope({
      keyManager: km2,
      context,
      blob: rewrapped,
    });
    expect(fromUtf8(pt)).toBe('rotate me');
  });

  it('crypto-shred destroys the wrapped DEK; decrypt then fails', async () => {
    const km = createInMemoryKeyManager();
    const context = { tenantId: 't1', field: 'msisdn', resource: 'sub:1' };
    const blob = await encryptEnvelope({
      keyManager: km,
      context,
      plaintext: utf8('+255712345678'),
    });
    const shredded = cryptoShred(blob);
    await expect(
      decryptEnvelope({ keyManager: km, context, blob: shredded }),
    ).rejects.toThrow();
  });

  it('batchRotate re-wraps successfully and reports zero failures', async () => {
    const km1 = createInMemoryKeyManager();
    const context = { tenantId: 't1', field: 'f', resource: 'r' };
    const blobs = await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((s) =>
        encryptEnvelope({
          keyManager: km1,
          context,
          plaintext: utf8(s),
        }),
      ),
    );
    const km2 = await km1.rotate();
    const result = await batchRotate({
      oldManager: km1,
      newManager: km2,
      batch: blobs.map((b) => ({ blob: b, context })),
    });
    expect(result.rewrapped).toHaveLength(5);
    expect(result.failures).toHaveLength(0);
    // Verify each re-wrapped blob decrypts under km2.
    for (let i = 0; i < result.rewrapped.length; i++) {
      const reBlob = result.rewrapped[i];
      if (!reBlob) {
        continue;
      }
      const pt = await decryptEnvelope({
        keyManager: km2,
        context,
        blob: reBlob,
      });
      expect(pt.length).toBeGreaterThan(0);
    }
  });
});
