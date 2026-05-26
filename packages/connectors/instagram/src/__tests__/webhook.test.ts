import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyInstagramWebhook } from '../ingest/webhook-receiver.js';

describe('verifyInstagramWebhook', () => {
  it('accepts a valid HMAC-SHA256 signature', () => {
    const secret = 'app-secret';
    const body = '{"event":"comment","object":"instagram"}';
    const sig =
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const out = verifyInstagramWebhook({
      headers: { 'X-Hub-Signature-256': sig },
      body,
      appSecret: secret,
    });
    expect(out.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const secret = 'app-secret';
    const body = '{"event":"comment","object":"instagram"}';
    const sig =
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const out = verifyInstagramWebhook({
      headers: { 'X-Hub-Signature-256': sig },
      body: body + 'x',
      appSecret: secret,
    });
    expect(out.valid).toBe(false);
    expect(out.reason).toBe('hmac mismatch');
  });

  it('rejects missing signature header', () => {
    const out = verifyInstagramWebhook({
      headers: {},
      body: '{}',
      appSecret: 'app-secret',
    });
    expect(out.valid).toBe(false);
    expect(out.reason).toBe('missing signature header');
  });
});
