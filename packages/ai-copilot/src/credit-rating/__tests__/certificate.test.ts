import { describe, it, expect } from 'vitest';
import {
  buildSignedCertificate,
  renderCertificateDocument,
  verifyCertificate,
  scoreTenantCredit,
  type CreditRatingInputs,
} from '../index.js';

const SECRET = 'unit-test-secret-32chars-minimum-length';
const BASE = 'https://api.borjie.com';

function makeRating() {
  const inputs: CreditRatingInputs = {
    tenantId: 't-1',
    customerId: 'c-1',
    totalInvoices: 12,
    paidOnTimeCount: 11,
    paidLate30DaysCount: 1,
    paidLate60DaysCount: 0,
    paidLate90PlusCount: 0,
    defaultCount: 0,
    extensionsGranted: 1,
    extensionsHonored: 1,
    installmentAgreementsOffered: 0,
    installmentAgreementsHonored: 0,
    rentToIncomeRatio: 0.25,
    avgTenancyMonths: 18,
    activeTenancyCount: 1,
    disputeCount: 0,
    damageDeductionCount: 0,
    subleaseViolationCount: 0,
    newestInvoiceAt: new Date().toISOString(),
    oldestInvoiceAt: new Date(Date.now() - 18 * 30 * 86400_000).toISOString(),
    asOf: new Date().toISOString(),
  };
  return scoreTenantCredit(inputs);
}

describe('credit-certificate', () => {
  it('builds a signed certificate', () => {
    const rating = makeRating();
    const cert = buildSignedCertificate({
      rating,
      signingSecret: SECRET,
      verificationBaseUrl: BASE,
    });
    expect(cert.algorithm).toBe('HMAC-SHA256');
    expect(cert.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(cert.payload.issuer).toBe('BORJIE');
  });

  it('verifies a valid certificate', () => {
    const rating = makeRating();
    const cert = buildSignedCertificate({
      rating,
      signingSecret: SECRET,
      verificationBaseUrl: BASE,
    });
    const v = verifyCertificate({ certificate: cert, signingSecret: SECRET });
    expect(v.valid).toBe(true);
    expect(v.reason).toBeNull();
  });

  it('rejects tampered signature', () => {
    const rating = makeRating();
    const cert = buildSignedCertificate({
      rating,
      signingSecret: SECRET,
      verificationBaseUrl: BASE,
    });
    // Flip the last hex nibble deterministically so tampering always
    // produces a different signature (using a fixed replacement char
    // like '0' is flaky — fails ~1/16 when the signature already ends
    // in '0').
    const lastChar = cert.signature.slice(-1);
    const flipped = lastChar === 'f' ? '0' : 'f';
    const tampered = {
      ...cert,
      signature: cert.signature.slice(0, -1) + flipped,
    };
    const v = verifyCertificate({
      certificate: tampered,
      signingSecret: SECRET,
    });
    expect(v.valid).toBe(false);
  });

  it('rejects wrong secret', () => {
    const rating = makeRating();
    const cert = buildSignedCertificate({
      rating,
      signingSecret: SECRET,
      verificationBaseUrl: BASE,
    });
    const v = verifyCertificate({
      certificate: cert,
      signingSecret: 'another-unit-test-secret-with-enough-length',
    });
    expect(v.valid).toBe(false);
  });

  it('rejects expired certificate', () => {
    const rating = makeRating();
    const cert = buildSignedCertificate({
      rating,
      signingSecret: SECRET,
      verificationBaseUrl: BASE,
      validityDays: 1,
      now: () => new Date(Date.now() - 10 * 86400_000).toISOString(),
    });
    const v = verifyCertificate({ certificate: cert, signingSecret: SECRET });
    expect(v.valid).toBe(false);
    expect(v.reason).toMatch(/expired/);
  });

  it('rejects short signing secrets', () => {
    const rating = makeRating();
    expect(() =>
      buildSignedCertificate({
        rating,
        signingSecret: 'short',
        verificationBaseUrl: BASE,
      }),
    ).toThrow();
  });

  it('renderCertificateDocument produces printable lines', () => {
    const rating = makeRating();
    const cert = buildSignedCertificate({
      rating,
      signingSecret: SECRET,
      verificationBaseUrl: BASE,
    });
    const doc = renderCertificateDocument(cert);
    expect(doc.title).toContain('BORJIE');
    expect(doc.lines.some((l) => l.includes('Score:'))).toBe(true);
    expect(doc.machineReadable).toBe(cert);
  });
});
