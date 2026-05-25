import { describe, expect, it, beforeAll } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  canonicalizeGepgEnvelope,
  signGepgEnvelope,
  verifyGepgEnvelope,
  GepgRsaError,
} from './gepg-rsa-signature';

// RSA-2048 keygen is CPU-bound and can exceed vitest's default 5s timeout
// when ~50 packages run in parallel (observed 6s+ per call). Cache two
// reusable keypairs in beforeAll so individual tests don't pay the keygen
// cost on every it() invocation.
let cachedSigning: { privateKeyPem: string; publicCertPem: string };
let cachedOther: { privateKeyPem: string; publicCertPem: string };

beforeAll(() => {
  cachedSigning = generateKeys();
  cachedOther = generateKeys();
}, 60_000);

function generateKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicCertPem: publicKey };
}

function fakeKeyPair() {
  // Default: return the cached signing pair so callers don't pay keygen.
  // Tests that need a *fresh* pair can call generateKeys() directly.
  return cachedSigning;
}

const SAMPLE = `<?xml version="1.0"?>
<gepgBillSubReq>
  <BillHdr>
    <SpCode>SP001</SpCode>
    <RtrRespFlg>true</RtrRespFlg>
  </BillHdr>
  <BillTrxInf>
    <BillId>INV-001</BillId>
  </BillTrxInf>
</gepgBillSubReq>`;

describe('canonicalizeGepgEnvelope', () => {
  it('strips XML declaration and whitespace between tags', () => {
    const out = canonicalizeGepgEnvelope(SAMPLE);
    expect(out.startsWith('<gepgBillSubReq>')).toBe(true);
    expect(out).not.toMatch(/>\s+</);
  });

  it('removes any existing signature block for re-signing idempotency', () => {
    const withSig = SAMPLE.replace(
      '</gepgBillSubReq>',
      '<gepgSignature>OLDSIG</gepgSignature></gepgBillSubReq>'
    );
    const out = canonicalizeGepgEnvelope(withSig);
    expect(out).not.toContain('gepgSignature');
  });
});

describe('sign/verify round-trip', () => {
  it('signs and verifies successfully with matching keys', () => {
    const keys = fakeKeyPair();
    const signed = signGepgEnvelope(SAMPLE, keys);
    expect(signed.xml).toContain('<gepgSignature>');
    expect(signed.signatureBase64.length).toBeGreaterThan(100);
    const r = verifyGepgEnvelope(signed.xml, keys);
    expect(r.valid).toBe(true);
  });

  it('fails verification with a different key', () => {
    // Use cached `cachedOther` to avoid a second keygen on every run.
    const signed = signGepgEnvelope(SAMPLE, cachedSigning);
    const r = verifyGepgEnvelope(signed.xml, { publicCertPem: cachedOther.publicCertPem });
    expect(r.valid).toBe(false);
  });

  it('throws MISSING_PRIVATE_KEY when no key is provided', () => {
    expect(() => signGepgEnvelope(SAMPLE, {})).toThrow(GepgRsaError);
  });

  it('returns not-valid when signature block is absent', () => {
    const keys = fakeKeyPair();
    const r = verifyGepgEnvelope(SAMPLE, keys);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('No <gepgSignature>');
  });
});
