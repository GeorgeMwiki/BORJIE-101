/**
 * Portable Credit Certificate.
 *
 * Produces a JSON payload that tenants can share with prospective landlords
 * or banks. The payload is HMAC-signed with a tenant-scoped secret so any
 * third party can verify authenticity without calling back into our API.
 *
 * The certificate is intentionally self-contained: score, band, letter
 * grade, dimension summary, issuing org id, issued-at, and expiry. No
 * personally identifying information beyond the customer reference — the
 * recipient must already know who the customer is (the tenant gave them
 * the file).
 *
 * Signing uses Node's `crypto` HMAC-SHA256. A verifier reimplementing this
 * outside our platform only needs the signing secret and the algorithm.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { CreditRating } from './credit-rating-types.js';

export interface CertificatePayload {
  readonly version: 'v1';
  readonly issuer: 'BORJIE';
  readonly tenantId: string;
  readonly customerId: string;
  readonly numericScore: number | null;
  readonly letterGrade: string | null;
  readonly band: string;
  readonly dimensions: Readonly<Record<string, number>>;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly verificationUrl: string;
}

export interface SignedCertificate {
  readonly payload: CertificatePayload;
  readonly signature: string;
  readonly algorithm: 'HMAC-SHA256';
}

export interface BuildCertificateOptions {
  readonly rating: CreditRating;
  readonly signingSecret: string;
  readonly verificationBaseUrl: string;
  readonly validityDays?: number;
  readonly now?: () => string;
}

const DEFAULT_VALIDITY_DAYS = 60;

function canonicalize(payload: CertificatePayload): string {
  // Stable stringify — keys sorted recursively so verification is
  // deterministic regardless of JS engine key order.
  return stableStringify(payload);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}

export function buildSignedCertificate(
  opts: BuildCertificateOptions,
): SignedCertificate {
  if (!opts.signingSecret || opts.signingSecret.length < 16) {
    throw new Error(
      'signingSecret must be at least 16 chars — configure CREDIT_CERT_SECRET.',
    );
  }
  const now = (opts.now ?? (() => new Date().toISOString()))();
  const validity = opts.validityDays ?? DEFAULT_VALIDITY_DAYS;
  const expiresAt = new Date(
    Date.parse(now) + validity * 24 * 60 * 60 * 1000,
  ).toISOString();

  const dimensionsSummary: Record<string, number> = {
    payment_history: opts.rating.dimensions.payment_history.score,
    promise_keeping: opts.rating.dimensions.promise_keeping.score,
    rent_to_income: opts.rating.dimensions.rent_to_income.score,
    tenancy_length: opts.rating.dimensions.tenancy_length.score,
    dispute_history: opts.rating.dimensions.dispute_history.score,
  };

  const payload: CertificatePayload = {
    version: 'v1',
    issuer: 'BORJIE',
    tenantId: opts.rating.tenantId,
    customerId: opts.rating.customerId,
    numericScore: opts.rating.numericScore,
    letterGrade: opts.rating.letterGrade,
    band: opts.rating.band,
    dimensions: dimensionsSummary,
    issuedAt: now,
    expiresAt,
    verificationUrl: `${opts.verificationBaseUrl.replace(/\/+$/, '')}/credit-rating/verify`,
  };

  const canonical = canonicalize(payload);
  const signature = createHmac('sha256', opts.signingSecret)
    .update(canonical)
    .digest('hex');

  return {
    payload,
    signature,
    algorithm: 'HMAC-SHA256',
  };
}

export interface CertificateVerifyOptions {
  readonly certificate: SignedCertificate;
  readonly signingSecret: string;
  readonly now?: () => string;
}

export interface VerificationResult {
  readonly valid: boolean;
  readonly reason: string | null;
}

export function verifyCertificate(opts: CertificateVerifyOptions): VerificationResult {
  const { certificate, signingSecret } = opts;
  if (!signingSecret) {
    return { valid: false, reason: 'signing secret not configured' };
  }
  if (certificate.algorithm !== 'HMAC-SHA256') {
    return { valid: false, reason: 'unsupported algorithm' };
  }
  const canonical = canonicalize(certificate.payload);
  const expected = createHmac('sha256', signingSecret)
    .update(canonical)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(certificate.signature, 'hex');
  if (expectedBuf.length !== actualBuf.length) {
    return { valid: false, reason: 'signature length mismatch' };
  }
  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'signature mismatch' };
  }

  const now = (opts.now ?? (() => new Date().toISOString()))();
  if (Date.parse(certificate.payload.expiresAt) < Date.parse(now)) {
    return { valid: false, reason: 'certificate expired' };
  }
  return { valid: true, reason: null };
}

/**
 * PDF-ish textual rendering — a printable summary the tenant can download.
 * Real PDF generation is delegated to the document-render service; this
 * function produces the structured content the renderer binds against.
 */
export interface CertificateDocument {
  readonly title: string;
  readonly lines: readonly string[];
  readonly machineReadable: SignedCertificate;
}

export function renderCertificateDocument(
  cert: SignedCertificate,
): CertificateDocument {
  const p = cert.payload;
  const scoreLine =
    p.numericScore === null
      ? 'Score: insufficient data'
      : `Score: ${p.numericScore} / 850 (${p.letterGrade}, ${p.band.replace('_', ' ')})`;

  return {
    title: 'BORJIE Tenant Credit Certificate',
    lines: [
      `Issuer: ${p.issuer}`,
      `Customer Reference: ${p.customerId}`,
      `Issued: ${p.issuedAt}`,
      `Expires: ${p.expiresAt}`,
      scoreLine,
      `Payment history: ${(p.dimensions.payment_history * 100).toFixed(0)}%`,
      `Promise keeping: ${(p.dimensions.promise_keeping * 100).toFixed(0)}%`,
      `Rent-to-income: ${(p.dimensions.rent_to_income * 100).toFixed(0)}%`,
      `Tenancy stability: ${(p.dimensions.tenancy_length * 100).toFixed(0)}%`,
      `Dispute clean-record: ${(p.dimensions.dispute_history * 100).toFixed(0)}%`,
      `Verify at: ${p.verificationUrl}`,
      `Signature (HMAC-SHA256): ${cert.signature}`,
    ],
    machineReadable: cert,
  };
}
