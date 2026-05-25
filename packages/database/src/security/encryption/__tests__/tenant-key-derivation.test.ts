/**
 * Tests for the per-tenant key derivation helper.
 *
 * Verifies:
 *   - loadMasterKeySnapshot rejects empty / undersized master key
 *   - loadMasterKeySnapshot accepts current + previous generation
 *   - deriveDek returns 32-byte keys (XChaCha20-Poly1305 / AES-256-GCM)
 *   - tenant A's key ≠ tenant B's key for the same column
 *   - same tenant, different table ⇒ different key (per-field isolation)
 *   - same tenant, different column ⇒ different key
 *   - same inputs ⇒ deterministic identical key (HKDF is a pure fn)
 *   - bumping keyVersion yields a NEW key (rotation domain separation)
 *   - asking for an unknown generation throws
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';

import {
  DEK_LENGTH_BYTES,
  deriveDek,
  loadMasterKeySnapshot,
  type MasterKeySnapshot,
} from '../tenant-key-derivation.js';
import { EncryptionKeyUnavailableError } from '../encryption-port.js';

function makeKeyBase64(): string {
  return Buffer.from(randomBytes(32)).toString('base64');
}

function snapshotWithBytes(bytes: Uint8Array, version = 1): MasterKeySnapshot {
  return { current: { version, bytes } };
}

describe('loadMasterKeySnapshot', () => {
  it('throws when ENCRYPTION_MASTER_KEY is missing', () => {
    expect(() => loadMasterKeySnapshot({})).toThrow(EncryptionKeyUnavailableError);
  });

  it('throws when ENCRYPTION_MASTER_KEY is shorter than 32 bytes', () => {
    expect(() =>
      loadMasterKeySnapshot({
        ENCRYPTION_MASTER_KEY: Buffer.from('short').toString('base64'),
      }),
    ).toThrow(EncryptionKeyUnavailableError);
  });

  it('accepts a valid 32-byte master key with default version=1', () => {
    const snap = loadMasterKeySnapshot({
      ENCRYPTION_MASTER_KEY: makeKeyBase64(),
    });
    expect(snap.current.version).toBe(1);
    expect(snap.current.bytes.length).toBe(32);
    expect(snap.previous).toBeUndefined();
  });

  it('honours explicit ENCRYPTION_MASTER_KEY_VERSION', () => {
    const snap = loadMasterKeySnapshot({
      ENCRYPTION_MASTER_KEY: makeKeyBase64(),
      ENCRYPTION_MASTER_KEY_VERSION: '7',
    });
    expect(snap.current.version).toBe(7);
  });

  it('loads previous generation when ENCRYPTION_MASTER_KEY_PREV is set', () => {
    const snap = loadMasterKeySnapshot({
      ENCRYPTION_MASTER_KEY: makeKeyBase64(),
      ENCRYPTION_MASTER_KEY_VERSION: '2',
      ENCRYPTION_MASTER_KEY_PREV: makeKeyBase64(),
      ENCRYPTION_MASTER_KEY_PREV_VERSION: '1',
    });
    expect(snap.previous?.version).toBe(1);
    expect(snap.previous?.bytes.length).toBe(32);
  });
});

describe('deriveDek', () => {
  const snap = snapshotWithBytes(randomBytes(32));
  const baseArgs = {
    snapshot: snap,
    keyVersion: 1,
    tenantId: 'tenant-a',
    table: 'customers',
    column: 'kra_pin',
  };

  it('returns a key of exactly DEK_LENGTH_BYTES (32) bytes', () => {
    const dek = deriveDek(baseArgs);
    expect(dek.length).toBe(DEK_LENGTH_BYTES);
    expect(DEK_LENGTH_BYTES).toBe(32);
  });

  it('is deterministic for identical inputs', () => {
    const a = deriveDek(baseArgs);
    const b = deriveDek(baseArgs);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('isolates tenant A from tenant B', () => {
    const tenantA = deriveDek(baseArgs);
    const tenantB = deriveDek({ ...baseArgs, tenantId: 'tenant-b' });
    expect(Buffer.from(tenantA).equals(Buffer.from(tenantB))).toBe(false);
  });

  it('isolates per-field (different column ⇒ different key)', () => {
    const kraPin = deriveDek(baseArgs);
    const email = deriveDek({ ...baseArgs, column: 'email' });
    expect(Buffer.from(kraPin).equals(Buffer.from(email))).toBe(false);
  });

  it('isolates per-table (different table ⇒ different key)', () => {
    const customers = deriveDek(baseArgs);
    const users = deriveDek({ ...baseArgs, table: 'users' });
    expect(Buffer.from(customers).equals(Buffer.from(users))).toBe(false);
  });

  it('separates key versions (rotation domain)', () => {
    const snap2 = {
      current: { version: 2, bytes: randomBytes(32) },
      previous: { version: 1, bytes: snap.current.bytes },
    } satisfies MasterKeySnapshot;
    const v1 = deriveDek({ ...baseArgs, snapshot: snap2, keyVersion: 1 });
    const v2 = deriveDek({ ...baseArgs, snapshot: snap2, keyVersion: 2 });
    expect(Buffer.from(v1).equals(Buffer.from(v2))).toBe(false);
  });

  it('throws when the requested key generation is not loaded', () => {
    expect(() => deriveDek({ ...baseArgs, keyVersion: 99 })).toThrow(
      EncryptionKeyUnavailableError,
    );
  });

  it('uses platform scope when tenantId is null', () => {
    const platform = deriveDek({ ...baseArgs, tenantId: null });
    const tenant = deriveDek({ ...baseArgs, tenantId: 'some-tenant' });
    expect(Buffer.from(platform).equals(Buffer.from(tenant))).toBe(false);
  });
});
