/**
 * GePG production RSA XML-DSig helper.
 *
 * Implements the bits of W3C XML-DSig 1.0 that GePG actually checks:
 *   - RSA-SHA256 over the canonicalized root element
 *   - Exclusive XML Canonicalization (EXC-C14N)
 *   - Base64-encoded SignatureValue appended as a sibling <gepgSignature> tag
 *
 * Zero external XML/crypto deps — uses Node's built-in `crypto` module
 * and a minimal in-tree canonicalizer that is correct for the tightly
 * constrained envelope shape GePG publishes. For full W3C compliance
 * across arbitrary XML, swap in `xml-crypto` by dependency-injecting a
 * different `canonicalize` function.
 */

import { createHash, createSign, createVerify } from 'node:crypto';

// ─────────────────────────────────────────────────────────────
// Canonicalization — minimal EXC-C14N subset for GePG envelopes
// ─────────────────────────────────────────────────────────────

/**
 * Normalize the payload string for signing/verification.
 * Rules applied (enough for the fixed-shape GePG envelopes):
 *   1. Strip XML declaration and leading/trailing whitespace
 *   2. Remove any existing <gepgSignature>...</gepgSignature> block
 *   3. Collapse whitespace between tags
 *   4. Normalize line endings to LF
 */
export function canonicalizeGepgEnvelope(xml: string): string {
  return xml
    .replace(/<\?xml[^?]*\?>/g, '')
    .replace(/<gepgSignature>[\s\S]*?<\/gepgSignature>/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/>\s+</g, '><')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// Sign / verify
// ─────────────────────────────────────────────────────────────

export interface GepgSignatureKeys {
  readonly privateKeyPem?: string;
  readonly publicCertPem?: string;
}

export interface SignedEnvelope {
  readonly xml: string;
  readonly signatureBase64: string;
  readonly digestBase64: string;
}

export class GepgRsaError extends Error {
  constructor(
    readonly code:
      | 'SIGNATURE_GENERATION_FAILED'
      | 'SIGNATURE_VERIFICATION_FAILED'
      | 'MISSING_PRIVATE_KEY'
      | 'MISSING_PUBLIC_CERT'
      | 'MALFORMED_ENVELOPE',
    message: string
  ) {
    super(message);
    this.name = 'GepgRsaError';
  }
}

/**
 * Produce a signed GePG envelope by appending <gepgSignature>BASE64</gepgSignature>
 * before the closing root tag. Assumes one top-level element (GePG always has this).
 */
export function signGepgEnvelope(
  xml: string,
  keys: GepgSignatureKeys
): SignedEnvelope {
  if (!keys.privateKeyPem) {
    throw new GepgRsaError('MISSING_PRIVATE_KEY', 'GEPG_SIGNING_KEY not configured');
  }
  const canonical = canonicalizeGepgEnvelope(xml);
  const digestBase64 = createHash('sha256').update(canonical, 'utf-8').digest('base64');
  const signer = createSign('RSA-SHA256');
  signer.update(canonical, 'utf-8');
  signer.end();
  let signatureBase64: string;
  try {
    signatureBase64 = signer.sign(keys.privateKeyPem).toString('base64');
  } catch (err) {
    throw new GepgRsaError(
      'SIGNATURE_GENERATION_FAILED',
      `Failed to sign envelope: ${(err as Error).message}`
    );
  }

  // Insert <gepgSignature> just before the closing root tag.
  const closingTagIdx = canonical.lastIndexOf('</');
  if (closingTagIdx < 0) {
    throw new GepgRsaError('MALFORMED_ENVELOPE', 'No closing root tag in canonicalized XML');
  }
  const signedXml =
    canonical.slice(0, closingTagIdx) +
    `<gepgSignature>${signatureBase64}</gepgSignature>` +
    canonical.slice(closingTagIdx);

  return { xml: signedXml, signatureBase64, digestBase64 };
}

/**
 * Verify a signed GePG envelope. Returns true if the signature matches the
 * payload under the provided public cert; false otherwise.
 */
export function verifyGepgEnvelope(
  xml: string,
  keys: GepgSignatureKeys
): { valid: boolean; reason?: string } {
  if (!keys.publicCertPem) {
    return { valid: false, reason: 'GEPG_SIGNING_CERT not configured' };
  }
  const match = xml.match(/<gepgSignature>([\s\S]*?)<\/gepgSignature>/);
  if (!match) return { valid: false, reason: 'No <gepgSignature> element' };
  const signatureBase64 = match[1]!.trim();
  const canonical = canonicalizeGepgEnvelope(xml);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(canonical, 'utf-8');
  verifier.end();
  try {
    const ok = verifier.verify(keys.publicCertPem, signatureBase64, 'base64');
    return ok ? { valid: true } : { valid: false, reason: 'Signature mismatch' };
  } catch (err) {
    return { valid: false, reason: (err as Error).message };
  }
}
