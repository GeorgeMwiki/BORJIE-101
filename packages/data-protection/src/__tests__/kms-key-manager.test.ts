/**
 * DP-06 — KMS-backed KeyManager + data-residency tagging tests.
 *
 * Proves:
 *   - envelope encryption round-trips through the KMS port (wrap/unwrap).
 *   - the EncryptionContext binds (tenant, field, resource): a blob minted
 *     for one context cannot be unwrapped under another (fail-closed).
 *   - the local-dev fallback (no SDK / no keyId) is deterministic per region.
 *   - residency tagging + compliance validation flags an out-of-region key.
 */

import { describe, it, expect } from 'vitest';
import { gcm } from '@noble/ciphers/aes';
import { utf8ToBytes } from '@noble/hashes/utils';

import {
  createKmsKeyManager,
  resolveRegionKeyManager,
  type KmsPort,
} from '../encrypt/kms-key-manager.js';
import { encryptEnvelope, decryptEnvelope } from '../encrypt/envelope.js';
import {
  tagResidency,
  checkResidencyCompliant,
  assertResidencyCompliant,
} from '../residency/index.js';

/**
 * Fake KMS port — emulates a CMK with a fixed 32-byte KEK, binding the
 * EncryptionContext as AES-GCM AAD exactly like real KMS binds its
 * EncryptionContext. A 12-byte zero nonce is fine for the test (one KEK, the
 * AAD provides the binding we assert on).
 */
function makeFakeKms(keyRef: string, region: string): KmsPort {
  const kek = new Uint8Array(32).fill(7);
  const nonce = new Uint8Array(12).fill(0);
  const aadOf = (ctx: Readonly<Record<string, string>>) =>
    utf8ToBytes(JSON.stringify(ctx));
  return {
    keyRef,
    region,
    async wrap({ plaintext, encryptionContext }) {
      return gcm(kek, nonce, aadOf(encryptionContext)).encrypt(plaintext);
    },
    async unwrap({ ciphertext, encryptionContext }) {
      // gcm.decrypt throws on AAD mismatch — that IS the context binding.
      return gcm(kek, nonce, aadOf(encryptionContext)).decrypt(ciphertext);
    },
  };
}

const CONTEXT = {
  tenantId: 'tenant-az',
  field: 'holder_nida',
  resource: 'licences',
} as const;

describe('createKmsKeyManager — envelope round-trip', () => {
  it('encrypts and decrypts through the KMS port', async () => {
    const km = createKmsKeyManager({ kms: makeFakeKms('arn:cmk:1', 'af-south-1') });
    const plaintext = utf8ToBytes('19900101-12345-00001-23');
    const blob = await encryptEnvelope({ keyManager: km, context: CONTEXT, plaintext });
    const out = await decryptEnvelope({ keyManager: km, context: CONTEXT, blob });
    expect(new TextDecoder().decode(out)).toBe('19900101-12345-00001-23');
    expect(km.keyRef).toBe('arn:cmk:1');
    expect(km.kind).toBe('customer-managed-byok');
  });

  it('fails closed when the unwrap context differs from the wrap context', async () => {
    const km = createKmsKeyManager({ kms: makeFakeKms('arn:cmk:1', 'af-south-1') });
    const blob = await encryptEnvelope({
      keyManager: km,
      context: CONTEXT,
      plaintext: utf8ToBytes('secret'),
    });
    // A different field → contextHash mismatch (caught before KMS) OR AAD
    // mismatch (caught in KMS). Either way: throw, never plaintext.
    await expect(
      decryptEnvelope({
        keyManager: km,
        context: { ...CONTEXT, field: 'other_field' },
        blob,
      }),
    ).rejects.toThrow();
  });

  it('rejects a wrapped DEK minted under a different keyRef', async () => {
    const kmA = createKmsKeyManager({ kms: makeFakeKms('arn:cmk:A', 'af-south-1') });
    const kmB = createKmsKeyManager({ kms: makeFakeKms('arn:cmk:B', 'af-south-1') });
    const blob = await encryptEnvelope({
      keyManager: kmA,
      context: CONTEXT,
      plaintext: utf8ToBytes('x'),
    });
    await expect(
      decryptEnvelope({ keyManager: kmB, context: CONTEXT, blob }),
    ).rejects.toThrow(/minted under/);
  });
});

describe('resolveRegionKeyManager — local-dev fallback', () => {
  it('falls back to a deterministic in-memory KEK when no keyId is set', async () => {
    const { manager, backedByKms } = await resolveRegionKeyManager({
      region: 'af-south-1',
    });
    expect(backedByKms).toBe(false);
    expect(manager.kind).toBe('platform-managed');
    // Same region → same keyRef (deterministic), so round-trips are stable.
    const second = await resolveRegionKeyManager({ region: 'af-south-1' });
    expect(second.manager.keyRef).toBe(manager.keyRef);
    // Different region → different KEK.
    const other = await resolveRegionKeyManager({ region: 'eu-west-1' });
    expect(other.manager.keyRef).not.toBe(manager.keyRef);
  });

  it('round-trips through the fallback manager', async () => {
    const { manager } = await resolveRegionKeyManager({ region: 'af-south-1' });
    const blob = await encryptEnvelope({
      keyManager: manager,
      context: CONTEXT,
      plaintext: utf8ToBytes('fallback-ok'),
    });
    const out = await decryptEnvelope({ keyManager: manager, context: CONTEXT, blob });
    expect(new TextDecoder().decode(out)).toBe('fallback-ok');
  });

  it('selects the KMS port when a keyId is configured and the SDK resolves', async () => {
    // The optional @aws-sdk/client-kms is hoisted in this monorepo, so with a
    // keyId the resolver picks the KMS-backed manager (a real Encrypt/Decrypt
    // would need credentials, but PORT SELECTION + key-bound manager identity
    // is what we assert here). If the SDK were absent this would degrade to
    // the local fallback (backedByKms=false) — both branches are exercised by
    // the no-keyId test above.
    const { manager, backedByKms } = await resolveRegionKeyManager({
      region: 'af-south-1',
      keyId: 'arn:aws:kms:af-south-1:1234:key/abc',
    });
    expect(backedByKms).toBe(true);
    expect(manager.keyRef).toBe('arn:aws:kms:af-south-1:1234:key/abc');
    expect(manager.kind).toBe('customer-managed-byok');
  });
});

describe('data-residency tagging', () => {
  it('tags a blob with its key region + classification', () => {
    const tag = tagResidency({
      tenantId: 'tenant-az',
      residencyRegion: 'af-south-1',
      keyRegion: 'af-south-1',
      classification: 'restricted',
      now: new Date('2026-06-08T00:00:00Z'),
    });
    expect(tag.keyRegion).toBe('af-south-1');
    expect(tag.tagHash).toHaveLength(64);
    expect(checkResidencyCompliant(tag).compliant).toBe(true);
  });

  it('flags an out-of-region key for a residency-bound class', () => {
    const tag = tagResidency({
      tenantId: 'tenant-az',
      residencyRegion: 'af-south-1',
      keyRegion: 'us-east-1', // wrapped under the wrong region!
      classification: 'pii',
    });
    const result = checkResidencyCompliant(tag);
    expect(result.compliant).toBe(false);
    expect(result.reason).toMatch(/af-south-1/);
    expect(() => assertResidencyCompliant(tag)).toThrow(/data-residency/);
  });

  it('allows any region for a non-bound class (e.g. public/internal)', () => {
    const tag = tagResidency({
      tenantId: 'tenant-az',
      residencyRegion: 'af-south-1',
      keyRegion: 'eu-west-1',
      classification: 'internal',
    });
    expect(checkResidencyCompliant(tag).compliant).toBe(true);
  });

  it('rejects a tampered tag (hash mismatch)', () => {
    const tag = tagResidency({
      tenantId: 'tenant-az',
      residencyRegion: 'af-south-1',
      keyRegion: 'af-south-1',
      classification: 'restricted',
    });
    const tampered = { ...tag, keyRegion: 'us-east-1' };
    const result = checkResidencyCompliant(tampered);
    expect(result.compliant).toBe(false);
    expect(result.reason).toMatch(/hash mismatch/);
  });
});
