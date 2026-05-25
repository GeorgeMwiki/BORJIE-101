/**
 * Per-vendor webhook signature verifiers.
 *
 * LITFIN ref: src/core/security/* (Stripe + M-Pesa + GePG + Twilio
 * shapes). Each verifier is a pure async function over a `CryptoPort`
 * so it stays testable without a node crypto import in the leaf.
 *
 * Shapes follow each vendor's documented spec as of 2026-Q2.
 */

import type { CryptoPort, SecurityClock } from './types.js';
import { DEFAULT_SECURITY_CLOCK } from './types.js';

export type VerifyResult =
  | { readonly ok: true; readonly vendor: string }
  | { readonly ok: false; readonly vendor: string; readonly reason: string };

// ---------------------------------------------------------------------
// Stripe — `Stripe-Signature` header: `t=<unix>,v1=<hex>`
// ---------------------------------------------------------------------

export interface StripeVerifyInput {
  readonly rawBody: string;
  readonly signatureHeader: string;
  readonly secret: string;
  /** Max age in seconds. Default 300 (Stripe's recommendation). */
  readonly toleranceSeconds?: number;
}

const parseStripeHeader = (
  header: string,
): { readonly t: number | null; readonly v1: readonly string[] } => {
  const parts = header.split(',').map((p) => p.trim());
  let t: number | null = null;
  const v1: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split('=', 2);
    if (k === 't' && v !== undefined) {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) t = n;
    } else if (k === 'v1' && v !== undefined) {
      v1.push(v);
    }
  }
  return { t, v1 };
};

export const verifyStripe = async (
  input: StripeVerifyInput,
  crypto: CryptoPort,
  clock: SecurityClock = DEFAULT_SECURITY_CLOCK,
): Promise<VerifyResult> => {
  const vendor = 'stripe';
  const { t, v1 } = parseStripeHeader(input.signatureHeader);
  if (t === null) return { ok: false, vendor, reason: 'missing-timestamp' };
  if (v1.length === 0) return { ok: false, vendor, reason: 'missing-v1' };
  const tolerance = input.toleranceSeconds ?? 300;
  const ageSec = Math.floor(clock.now() / 1000) - t;
  if (Math.abs(ageSec) > tolerance) {
    return { ok: false, vendor, reason: 'timestamp-out-of-tolerance' };
  }
  const expected = await crypto.hmacSha256Hex(input.secret, `${t}.${input.rawBody}`);
  for (const sig of v1) {
    if (crypto.timingSafeEqualHex(expected, sig)) return { ok: true, vendor };
  }
  return { ok: false, vendor, reason: 'signature-mismatch' };
};

// ---------------------------------------------------------------------
// M-Pesa (Safaricom Daraja) — `x-mpesa-signature: <hex>` over rawBody
// ---------------------------------------------------------------------

export interface MpesaVerifyInput {
  readonly rawBody: string;
  readonly signatureHeader: string;
  readonly secret: string;
}

export const verifyMpesa = async (
  input: MpesaVerifyInput,
  crypto: CryptoPort,
): Promise<VerifyResult> => {
  const vendor = 'mpesa';
  const sig = input.signatureHeader.trim();
  if (sig.length === 0) return { ok: false, vendor, reason: 'missing-signature' };
  const expected = await crypto.hmacSha256Hex(input.secret, input.rawBody);
  if (crypto.timingSafeEqualHex(expected, sig)) return { ok: true, vendor };
  return { ok: false, vendor, reason: 'signature-mismatch' };
};

// ---------------------------------------------------------------------
// GePG (Government e-Payment Gateway, Tanzania) — base64 signature in
// `<signature>` element of the SOAP body. Verifier accepts the parsed
// (raw-xml-canonical, signature) pair so we don't drag xmldom in.
// ---------------------------------------------------------------------

export interface GepgVerifyInput {
  readonly canonicalXml: string;
  readonly signatureBase64: string;
  readonly secret: string;
}

const base64ToHex = (b64: string): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('hex');
  }
  const bin = atob(b64);
  let out = '';
  for (let i = 0; i < bin.length; i++) {
    out += bin.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return out;
};

export const verifyGepg = async (
  input: GepgVerifyInput,
  crypto: CryptoPort,
): Promise<VerifyResult> => {
  const vendor = 'gepg';
  if (input.signatureBase64.length === 0) {
    return { ok: false, vendor, reason: 'missing-signature' };
  }
  const expected = await crypto.hmacSha256Hex(input.secret, input.canonicalXml);
  const got = base64ToHex(input.signatureBase64);
  if (crypto.timingSafeEqualHex(expected, got)) return { ok: true, vendor };
  return { ok: false, vendor, reason: 'signature-mismatch' };
};

// ---------------------------------------------------------------------
// Twilio — `x-twilio-signature: <base64-hmac-sha1>`
// Twilio actually uses SHA-1; we provide a SHA-1 hex helper too.
// ---------------------------------------------------------------------

export interface TwilioCryptoPort extends CryptoPort {
  readonly hmacSha1Hex: (secret: string, data: string) => Promise<string>;
}

export interface TwilioVerifyInput {
  readonly url: string;
  readonly params: Readonly<Record<string, string>>;
  readonly signatureHeader: string;
  readonly authToken: string;
}

const twilioCanonical = (
  url: string,
  params: Readonly<Record<string, string>>,
): string => {
  const keys = Object.keys(params).sort();
  return keys.reduce((acc, k) => acc + k + (params[k] ?? ''), url);
};

export const verifyTwilio = async (
  input: TwilioVerifyInput,
  crypto: TwilioCryptoPort,
): Promise<VerifyResult> => {
  const vendor = 'twilio';
  const canonical = twilioCanonical(input.url, input.params);
  const expectedHex = await crypto.hmacSha1Hex(input.authToken, canonical);
  const gotHex = base64ToHex(input.signatureHeader);
  if (crypto.timingSafeEqualHex(expectedHex, gotHex)) return { ok: true, vendor };
  return { ok: false, vendor, reason: 'signature-mismatch' };
};
