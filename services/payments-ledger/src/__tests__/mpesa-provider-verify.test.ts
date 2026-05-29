/**
 * Robustness audit 2026-05-29 — D6 (security depth).
 *
 * `MpesaPaymentProvider.verifyWebhookSignature` previously returned
 * `true` unconditionally so any future caller wiring this method into
 * a webhook receiver would silently accept unsigned payloads. The
 * production receiver is guarded by `mpesaSignatureMiddleware`, so
 * the provider method is currently dead code — but it is a footgun.
 *
 * These tests pin the new behaviour: HMAC-SHA256(secret, raw) compared
 * with `timingSafeEqual`. Empty inputs and shape mismatches fail closed.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { MpesaPaymentProvider } from '../providers/mpesa-provider';

function makeProvider(): MpesaPaymentProvider {
  return new MpesaPaymentProvider({
    consumerKey: 'k',
    consumerSecret: 's',
    shortCode: '174379',
    passKey: 'p',
    environment: 'sandbox',
    callbackBaseUrl: 'https://callbacks.example',
  });
}

const SECRET = 'mpesa-webhook-secret-456';

describe('MpesaPaymentProvider.verifyWebhookSignature (robustness D6)', () => {
  it('accepts a payload signed with the configured secret', () => {
    const provider = makeProvider();
    const payload = JSON.stringify({ Body: { stkCallback: { ResultCode: 0 } } });
    const sig = createHmac('sha256', SECRET).update(payload).digest('hex');
    expect(provider.verifyWebhookSignature(payload, sig, SECRET)).toBe(true);
  });

  it('rejects a payload with a wrong signature', () => {
    const provider = makeProvider();
    const payload = JSON.stringify({ foo: 'bar' });
    const wrong = 'a'.repeat(64);
    expect(provider.verifyWebhookSignature(payload, wrong, SECRET)).toBe(false);
  });

  it('rejects when the secret is missing', () => {
    const provider = makeProvider();
    const payload = 'x';
    const sig = createHmac('sha256', SECRET).update(payload).digest('hex');
    expect(provider.verifyWebhookSignature(payload, sig, '')).toBe(false);
  });

  it('rejects when the signature is missing', () => {
    const provider = makeProvider();
    expect(provider.verifyWebhookSignature('x', '', SECRET)).toBe(false);
  });

  it('rejects an empty payload (cannot be a real Daraja callback)', () => {
    const provider = makeProvider();
    const sig = createHmac('sha256', SECRET).update('').digest('hex');
    expect(provider.verifyWebhookSignature('', sig, SECRET)).toBe(false);
  });

  it('accepts a Buffer payload signed with the configured secret', () => {
    const provider = makeProvider();
    const buf = Buffer.from(JSON.stringify({ ok: true }), 'utf8');
    const sig = createHmac('sha256', SECRET).update(buf.toString('utf8')).digest('hex');
    expect(provider.verifyWebhookSignature(buf, sig, SECRET)).toBe(true);
  });

  it('rejects malformed hex signatures without throwing', () => {
    const provider = makeProvider();
    // odd-length hex / non-hex chars — must NOT throw, must return false.
    expect(provider.verifyWebhookSignature('x', 'not-hex', SECRET)).toBe(false);
    expect(provider.verifyWebhookSignature('x', 'abc', SECRET)).toBe(false);
  });
});
