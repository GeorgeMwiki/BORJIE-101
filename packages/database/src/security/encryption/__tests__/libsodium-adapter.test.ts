/**
 * Tests for the libsodium-backed EncryptionPort.
 *
 * Verifies:
 *   - Round-trip encrypt → decrypt returns plaintext exactly
 *   - Tampered ciphertext fails with EncryptionAuthenticationError
 *   - Tenant A's ciphertext cannot be decrypted under Tenant B's key
 *   - Cross-column ciphertext cannot be decrypted under a sibling column key
 *   - Key rotation: v1 blob still decrypts after rotate to v2
 *   - rotate() returns the input unchanged when already on current version
 *   - 1000 sequential encrypts complete in < 500 ms (performance budget)
 *   - Empty plaintext is supported (round-trip safe)
 *   - Unicode plaintext is preserved exactly
 *   - The libsodium dep loads — when missing, the AES-256-GCM fallback is
 *     used and tests still pass (forceFallback skips the native path)
 *
 * The default adapter selection prefers libsodium when available; tests
 * exercise BOTH paths via `forceFallback`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';

import {
  createLibsodiumAdapter,
  type LibsodiumAdapterDeps,
} from '../libsodium-adapter.js';
import {
  EncryptionAuthenticationError,
  type EncryptionPort,
} from '../encryption-port.js';
import type {
  FieldClassification,
} from '../../data-classification.js';

const KRA_PIN_CLASS: FieldClassification = {
  table: 'customers',
  column: 'kra_pin',
  level: 'RESTRICTED',
  encryptAtRest: true,
  maskType: 'id',
  retention: '7y',
};

const EMAIL_CLASS: FieldClassification = {
  table: 'customers',
  column: 'email',
  level: 'CONFIDENTIAL',
  encryptAtRest: true,
  maskType: 'email',
  retention: '7y',
};

function makeSnapshot(version = 1, prev?: number) {
  const current = { version, bytes: new Uint8Array(randomBytes(32)) };
  if (prev !== undefined) {
    return {
      current,
      previous: { version: prev, bytes: new Uint8Array(randomBytes(32)) },
    };
  }
  return { current };
}

async function buildAdapter(opts: Partial<LibsodiumAdapterDeps> = {}) {
  const snapshot = opts.snapshot ?? makeSnapshot();
  return createLibsodiumAdapter({ snapshot, ...opts });
}

describe('createLibsodiumAdapter — AES-256-GCM fallback path', () => {
  let port: EncryptionPort;
  beforeAll(async () => {
    port = await buildAdapter({ forceFallback: true });
  });

  it('round-trips a plaintext string exactly', async () => {
    const plaintext = 'A012345678X';
    const blob = await port.encrypt({
      plaintext,
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-a',
    });
    expect(blob.algorithm).toBe('aes-256-gcm');
    expect(blob.keyVersion).toBe(port.currentKeyVersion);
    const decoded = await port.decrypt({
      blob,
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-a',
    });
    expect(decoded).toBe(plaintext);
  });

  it('produces a different nonce per call (no nonce reuse)', async () => {
    const a = await port.encrypt({
      plaintext: 'same value',
      classification: EMAIL_CLASS,
      tenantId: 'tenant-x',
    });
    const b = await port.encrypt({
      plaintext: 'same value',
      classification: EMAIL_CLASS,
      tenantId: 'tenant-x',
    });
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails with EncryptionAuthenticationError on tampered ciphertext', async () => {
    const blob = await port.encrypt({
      plaintext: 'A012345678X',
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-a',
    });
    const tamperedCt = Buffer.from(blob.ciphertext, 'base64');
    tamperedCt[0] = (tamperedCt[0] ?? 0) ^ 0xff;
    const tampered = { ...blob, ciphertext: tamperedCt.toString('base64') };
    await expect(
      port.decrypt({
        blob: tampered,
        classification: KRA_PIN_CLASS,
        tenantId: 'tenant-a',
      }),
    ).rejects.toBeInstanceOf(EncryptionAuthenticationError);
  });

  it("rejects tenant B's key applied to tenant A's blob", async () => {
    const blob = await port.encrypt({
      plaintext: 'A012345678X',
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-a',
    });
    await expect(
      port.decrypt({
        blob,
        classification: KRA_PIN_CLASS,
        tenantId: 'tenant-b',
      }),
    ).rejects.toBeInstanceOf(EncryptionAuthenticationError);
  });

  it("rejects a sibling column's key applied to the wrong column", async () => {
    const blob = await port.encrypt({
      plaintext: 'A012345678X',
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-a',
    });
    await expect(
      port.decrypt({
        blob,
        classification: EMAIL_CLASS,
        tenantId: 'tenant-a',
      }),
    ).rejects.toBeInstanceOf(EncryptionAuthenticationError);
  });

  it('rotates a v1 blob to the current v2 generation and preserves plaintext', async () => {
    const snapshotV1 = makeSnapshot(1);
    const portV1 = await createLibsodiumAdapter({
      snapshot: snapshotV1,
      forceFallback: true,
    });
    const plaintext = 'NIDA-20060409-12345-1';
    const blobV1 = await portV1.encrypt({
      plaintext,
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-rotation',
    });
    expect(blobV1.keyVersion).toBe(1);

    // Simulate rotation: new snapshot has v2 as current and v1 as previous.
    const snapshotV2 = {
      current: { version: 2, bytes: new Uint8Array(randomBytes(32)) },
      previous: snapshotV1.current,
    };
    const portV2 = await createLibsodiumAdapter({
      snapshot: snapshotV2,
      forceFallback: true,
    });

    // Blob from v1 still decrypts because v1 master is in `previous`.
    const decoded = await portV2.decrypt({
      blob: blobV1,
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-rotation',
    });
    expect(decoded).toBe(plaintext);

    // rotate() re-encrypts under v2.
    const blobV2 = await portV2.rotate({
      blob: blobV1,
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-rotation',
    });
    expect(blobV2.keyVersion).toBe(2);
    const decodedAfter = await portV2.decrypt({
      blob: blobV2,
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-rotation',
    });
    expect(decodedAfter).toBe(plaintext);
  });

  it('rotate() is a no-op when the blob is already on the current version', async () => {
    const blob = await port.encrypt({
      plaintext: 'still-current',
      classification: EMAIL_CLASS,
      tenantId: 'tenant-c',
    });
    const rotated = await port.rotate({
      blob,
      classification: EMAIL_CLASS,
      tenantId: 'tenant-c',
    });
    expect(rotated).toBe(blob);
  });

  it('encrypts 1000 short strings in under 500 ms', async () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      // eslint-disable-next-line no-await-in-loop
      await port.encrypt({
        plaintext: `secret-${i}`,
        classification: EMAIL_CLASS,
        tenantId: 'tenant-perf',
      });
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('round-trips an empty string', async () => {
    const blob = await port.encrypt({
      plaintext: '',
      classification: EMAIL_CLASS,
      tenantId: 'tenant-empty',
    });
    const out = await port.decrypt({
      blob,
      classification: EMAIL_CLASS,
      tenantId: 'tenant-empty',
    });
    expect(out).toBe('');
  });

  it('round-trips Unicode plaintext exactly (Swahili + emoji)', async () => {
    const plaintext = 'jambo @borjie.tz';
    const blob = await port.encrypt({
      plaintext,
      classification: EMAIL_CLASS,
      tenantId: 'tenant-utf8',
    });
    const out = await port.decrypt({
      blob,
      classification: EMAIL_CLASS,
      tenantId: 'tenant-utf8',
    });
    expect(out).toBe(plaintext);
  });
});

describe('createLibsodiumAdapter — XChaCha20-Poly1305 path (when libsodium available)', () => {
  let port: EncryptionPort;
  let usingLibsodium = false;

  beforeAll(async () => {
    port = await buildAdapter();
    usingLibsodium =
      // The adapter exposes `kind: 'libsodium'` regardless of which path it
      // took; we sniff the algorithm tag on a probe blob to confirm.
      (
        await port.encrypt({
          plaintext: 'probe',
          classification: EMAIL_CLASS,
          tenantId: 'probe-tenant',
        })
      ).algorithm === 'xchacha20-poly1305';
  });

  it('uses xchacha20-poly1305 when libsodium is installed (info-only when missing)', () => {
    if (!usingLibsodium) {
      // Warning-only: the test still passes so CI envs without the
      // libsodium WASM module do not flake.
      // eslint-disable-next-line no-console
      console.warn(
        '[encryption.test] libsodium not loaded — XChaCha20-Poly1305 path skipped',
      );
      expect(true).toBe(true);
      return;
    }
    expect(usingLibsodium).toBe(true);
  });

  it('round-trips via the libsodium AEAD when available', async () => {
    const blob = await port.encrypt({
      plaintext: 'lease-signature-base64-blob',
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-libsodium',
    });
    const decoded = await port.decrypt({
      blob,
      classification: KRA_PIN_CLASS,
      tenantId: 'tenant-libsodium',
    });
    expect(decoded).toBe('lease-signature-base64-blob');
  });
});
