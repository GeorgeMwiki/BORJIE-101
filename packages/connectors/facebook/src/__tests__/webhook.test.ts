import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyFacebookWebhook } from '../ingest/webhook-receiver.js';

describe('verifyFacebookWebhook', () => {
  it('accepts a valid HMAC-SHA256 signature', () => {
    const secret = 's';
    const body = '{"object":"page","entry":[]}';
    const sig =
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const out = verifyFacebookWebhook({
      headers: { 'X-Hub-Signature-256': sig },
      body,
      appSecret: secret,
    });
    expect(out.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const secret = 's';
    const body = '{"object":"page"}';
    const sig =
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const out = verifyFacebookWebhook({
      headers: { 'X-Hub-Signature-256': sig },
      body: body + '!',
      appSecret: secret,
    });
    expect(out.valid).toBe(false);
  });

  it('rejects a missing signature header', () => {
    const out = verifyFacebookWebhook({
      headers: {},
      body: '{}',
      appSecret: 's',
    });
    expect(out.valid).toBe(false);
  });
});
