import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyWhatsappSignature } from '../ingest/webhook-receiver.js';

describe('verifyWhatsappSignature (HMAC-SHA256 X-Hub-Signature-256)', () => {
  const APP_SECRET = 'test-app-secret-for-mr-mwikila';
  const rawBody = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('accepts a correctly-signed payload', () => {
    const expected =
      'sha256=' +
      createHmac('sha256', APP_SECRET).update(rawBody, 'utf8').digest('hex');
    expect(
      verifyWhatsappSignature({
        rawBody,
        signatureHeader: expected,
        appSecret: APP_SECRET,
      }),
    ).toBe(true);
  });

  it('rejects a payload with no signature header', () => {
    expect(
      verifyWhatsappSignature({
        rawBody,
        signatureHeader: null,
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a payload with the wrong signature scheme', () => {
    const expectedHex = createHmac('sha256', APP_SECRET)
      .update(rawBody, 'utf8')
      .digest('hex');
    expect(
      verifyWhatsappSignature({
        rawBody,
        signatureHeader: `sha1=${expectedHex}`, // wrong prefix
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a payload signed with the wrong secret', () => {
    const wrongSig =
      'sha256=' +
      createHmac('sha256', 'wrong-secret').update(rawBody, 'utf8').digest('hex');
    expect(
      verifyWhatsappSignature({
        rawBody,
        signatureHeader: wrongSig,
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it('rejects a tampered payload (body changed after signing)', () => {
    const sigOfOriginal =
      'sha256=' +
      createHmac('sha256', APP_SECRET).update(rawBody, 'utf8').digest('hex');
    const tamperedBody = rawBody + '{"injected":true}';
    expect(
      verifyWhatsappSignature({
        rawBody: tamperedBody,
        signatureHeader: sigOfOriginal,
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });

  it('rejects malformed hex in the signature value', () => {
    expect(
      verifyWhatsappSignature({
        rawBody,
        signatureHeader: 'sha256=not-hex-data',
        appSecret: APP_SECRET,
      }),
    ).toBe(false);
  });
});
