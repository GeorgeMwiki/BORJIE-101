/**
 * Round-3 audit C1 + C2 + C3 regression tests.
 *
 * These cover the WhatsApp webhook signature validator and the payload
 * parser. They MUST keep passing — any regression here re-opens a
 * production-fatal CRITICAL.
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { MetaWhatsAppClient, WebhookPayloadParseError } from '../meta-client.js';

function buildClient(appSecret?: string): MetaWhatsAppClient {
  return new MetaWhatsAppClient({
    accessToken: 'test-token',
    phoneNumberId: '123',
    appSecret,
    webhookVerifyToken: 'verify-token',
    apiUrl: 'https://example.test/v18.0',
  });
}

function computeSignature(payload: string, secret: string): string {
  return (
    'sha256=' +
    crypto.createHmac('sha256', secret).update(payload).digest('hex')
  );
}

describe('MetaWhatsAppClient.validateWebhookSignature (C1, C2)', () => {
  it('C1: returns FALSE when app secret is unset — fail-closed', () => {
    const client = buildClient(undefined);
    const result = client.validateWebhookSignature('{"any":"body"}', 'sha256=anything');
    expect(result).toBe(false);
  });

  it('C1: returns FALSE when app secret is the empty string', () => {
    const client = buildClient('');
    const result = client.validateWebhookSignature('{"any":"body"}', 'sha256=anything');
    expect(result).toBe(false);
  });

  it('C2: returns FALSE on length-mismatched signature without throwing', () => {
    const client = buildClient('the-secret');
    // Length 3 — far shorter than `sha256=` + 64 hex chars.
    expect(() =>
      client.validateWebhookSignature('{"any":"body"}', 'foo')
    ).not.toThrow();
    expect(client.validateWebhookSignature('{"any":"body"}', 'foo')).toBe(false);
  });

  it('C2: returns FALSE on signature with right length but wrong bytes', () => {
    const client = buildClient('the-secret');
    const fakeSig = 'sha256=' + 'a'.repeat(64);
    expect(client.validateWebhookSignature('{"any":"body"}', fakeSig)).toBe(false);
  });

  it('returns TRUE on a correctly-signed payload', () => {
    const secret = 'the-secret';
    const payload = '{"any":"body"}';
    const sig = computeSignature(payload, secret);
    const client = buildClient(secret);
    expect(client.validateWebhookSignature(payload, sig)).toBe(true);
  });

  it('returns FALSE on an empty signature header', () => {
    const client = buildClient('the-secret');
    expect(client.validateWebhookSignature('{"any":"body"}', '')).toBe(false);
  });

  it('does NOT throw RangeError on x-hub-signature-256: foo (specific regression)', () => {
    const client = buildClient('the-secret');
    // The exact value cited in the audit brief.
    expect(() =>
      client.validateWebhookSignature('{"any":"body"}', 'foo')
    ).not.toThrow();
  });
});

describe('MetaWhatsAppClient.parseWebhookPayload (C3)', () => {
  it('throws WebhookPayloadParseError when the body is not an object', () => {
    const client = buildClient('the-secret');
    expect(() => client.parseWebhookPayload(null)).toThrow(WebhookPayloadParseError);
    expect(() => client.parseWebhookPayload('a string')).toThrow(WebhookPayloadParseError);
  });

  it('throws when `object` is not whatsapp_business_account', () => {
    const client = buildClient('the-secret');
    expect(() =>
      client.parseWebhookPayload({ object: 'something_else', entry: [] })
    ).toThrow(WebhookPayloadParseError);
  });

  it('parses a well-formed whatsapp_business_account payload', () => {
    const client = buildClient('the-secret');
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { id: 'msg-1', from: '+254712345678', type: 'text', timestamp: '0' },
                ],
                contacts: [{ wa_id: '+254712345678', profile: { name: 'Test' } }],
              },
            },
          ],
        },
      ],
    };
    const result = client.parseWebhookPayload(body);
    expect(result.messages).toHaveLength(1);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.wa_id).toBe('+254712345678');
  });

  it('does NOT swallow malformed contact rows silently', () => {
    const client = buildClient('the-secret');
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [null, { wa_id: '+1', profile: { name: 'OK' } }],
              },
            },
          ],
        },
      ],
    };
    const result = client.parseWebhookPayload(body);
    // The null entry was dropped; the well-formed entry was kept.
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]?.wa_id).toBe('+1');
  });
});
