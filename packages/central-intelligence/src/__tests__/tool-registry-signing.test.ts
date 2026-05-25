/**
 * Tool-registry Ed25519 signing — D9 tests.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalJson,
  generateToolSignatureKeyPair,
  signToolSpec,
  verifyToolSignature,
} from '../kernel/tool-spec/tool-registry-signing.js';

const SAMPLE = {
  name: 'lookupTenantArrears',
  description: 'Return the arrears balance for a tenant profile.',
  tier: 'free',
  requiresApproval: false,
  schemaInSig: 'sha256:abc123',
  schemaOutSig: 'sha256:def456',
};

describe('tool-registry signing', () => {
  it('canonicalJson sorts keys deterministically', () => {
    const a = canonicalJson({ b: 1, a: 2, c: 3 } as never);
    const b = canonicalJson({ a: 2, b: 1, c: 3 } as never);
    expect(a).toBe(b);
  });

  it('signToolSpec + verifyToolSignature roundtrip succeeds', async () => {
    const { privateKey, publicKey } = await generateToolSignatureKeyPair('pub_1');
    const manifest = await signToolSpec(SAMPLE, privateKey);
    const outcome = await verifyToolSignature(SAMPLE, manifest, [publicKey]);
    expect(outcome.ok).toBe(true);
    expect(outcome.matchedKeyId).toBe('pub_1');
  });

  it('verifyToolSignature rejects tampered specs', async () => {
    const { privateKey, publicKey } = await generateToolSignatureKeyPair('pub_1');
    const manifest = await signToolSpec(SAMPLE, privateKey);
    const tampered = { ...SAMPLE, requiresApproval: true };
    const outcome = await verifyToolSignature(tampered, manifest, [publicKey]);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/canonical mismatch/);
  });

  it('verifyToolSignature rejects when no trusted key matches', async () => {
    const { privateKey } = await generateToolSignatureKeyPair('pub_1');
    const { publicKey: other } = await generateToolSignatureKeyPair('pub_2');
    const manifest = await signToolSpec(SAMPLE, privateKey);
    const outcome = await verifyToolSignature(SAMPLE, manifest, [other]);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toMatch(/no trusted key/);
  });

  it('verifyToolSignature accepts when one of several keys matches', async () => {
    const { privateKey, publicKey } = await generateToolSignatureKeyPair('pub_1');
    const { publicKey: other } = await generateToolSignatureKeyPair('pub_2');
    const manifest = await signToolSpec(SAMPLE, privateKey);
    const outcome = await verifyToolSignature(SAMPLE, manifest, [other, publicKey]);
    expect(outcome.ok).toBe(true);
    expect(outcome.matchedKeyId).toBe('pub_1');
  });
});
