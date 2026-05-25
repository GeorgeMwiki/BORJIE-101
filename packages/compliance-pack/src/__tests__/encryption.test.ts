/**
 * Envelope-encryption tests.
 *
 * The most important assertion: a ciphertext encrypted for tenant A
 * MUST FAIL to decrypt under tenant B's context. If this test is
 * removed or weakened, we have lost the multi-tenant isolation
 * guarantee.
 */

import { describe, expect, it } from 'vitest';

import {
  bindField,
  createInMemoryEnvelopeEncryptor,
  digestEncryptionContext,
} from '../encryption/index.js';
import { EncryptionContextMismatchError } from '../types.js';

describe('encryption: in-memory adapter', () => {
  it('round-trips plaintext under the same context', async () => {
    const enc = createInMemoryEnvelopeEncryptor();
    const ctx = { tenantId: 't_1', field: 'email', resource: 'users' };
    const env = await enc.encrypt({ plaintext: 'alice@example.com', context: ctx });
    const out = await enc.decrypt({ envelope: env, context: ctx });
    expect(out).toBe('alice@example.com');
    expect(env.algorithm).toBe('AES-256-GCM');
  });

  it('produces fresh ciphertexts each time (no caching, no determinism)', async () => {
    const enc = createInMemoryEnvelopeEncryptor();
    const ctx = { tenantId: 't_1', field: 'email', resource: 'users' };
    const a = await enc.encrypt({ plaintext: 'same', context: ctx });
    const b = await enc.encrypt({ plaintext: 'same', context: ctx });
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedDek).not.toBe(b.wrappedDek);
  });

  it('FAILS cross-tenant decryption (multi-tenant isolation)', async () => {
    const enc = createInMemoryEnvelopeEncryptor();
    const ctxA = { tenantId: 'tenant_A', field: 'email', resource: 'users' };
    const ctxB = { tenantId: 'tenant_B', field: 'email', resource: 'users' };
    const env = await enc.encrypt({ plaintext: 'secret', context: ctxA });
    await expect(enc.decrypt({ envelope: env, context: ctxB })).rejects.toThrow(
      EncryptionContextMismatchError,
    );
  });

  it('FAILS when field is tampered in the context', async () => {
    const enc = createInMemoryEnvelopeEncryptor();
    const ctx = { tenantId: 't_1', field: 'email', resource: 'users' };
    const env = await enc.encrypt({ plaintext: 'secret', context: ctx });
    await expect(
      enc.decrypt({
        envelope: env,
        context: { ...ctx, field: 'phone' },
      }),
    ).rejects.toThrow(EncryptionContextMismatchError);
  });

  it('FAILS when resource is tampered in the context', async () => {
    const enc = createInMemoryEnvelopeEncryptor();
    const ctx = { tenantId: 't_1', field: 'email', resource: 'users' };
    const env = await enc.encrypt({ plaintext: 'secret', context: ctx });
    await expect(
      enc.decrypt({
        envelope: env,
        context: { ...ctx, resource: 'leases' },
      }),
    ).rejects.toThrow(EncryptionContextMismatchError);
  });

  it('FAILS when the envelope was created by a different encryptor (different KEK)', async () => {
    const encA = createInMemoryEnvelopeEncryptor({ keyId: 'k_a' });
    const encB = createInMemoryEnvelopeEncryptor({ keyId: 'k_b' });
    const ctx = { tenantId: 't_1', field: 'email', resource: 'users' };
    const env = await encA.encrypt({ plaintext: 'x', context: ctx });
    await expect(encB.decrypt({ envelope: env, context: ctx })).rejects.toThrow(
      EncryptionContextMismatchError,
    );
  });

  it('rejects a KEK of the wrong length', () => {
    expect(() =>
      createInMemoryEnvelopeEncryptor({ kek: Buffer.alloc(10) }),
    ).toThrow(/32 bytes/);
  });
});

describe('encryption: digestEncryptionContext', () => {
  it('is deterministic and depends on every field', () => {
    const a = digestEncryptionContext({ tenantId: 't', field: 'e', resource: 'u' });
    const b = digestEncryptionContext({ tenantId: 't', field: 'e', resource: 'u' });
    expect(a).toBe(b);
    expect(a).not.toBe(
      digestEncryptionContext({ tenantId: 't', field: 'e', resource: 'leases' }),
    );
  });
});

describe('encryption: bindField helper', () => {
  it('encrypts/decrypts via the bound context', async () => {
    const enc = createInMemoryEnvelopeEncryptor();
    const ctx = { tenantId: 't_1', field: 'email', resource: 'users' };
    const bound = bindField(enc, ctx);
    const env = await bound.encryptField('alice@x');
    const out = await bound.decryptField(env);
    expect(out).toBe('alice@x');
  });
});
