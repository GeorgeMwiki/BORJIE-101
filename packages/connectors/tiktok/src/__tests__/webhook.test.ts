import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyTikTokWebhook } from '../ingest/webhook-receiver.js';

describe('verifyTikTokWebhook', () => {
  const secret = 'tt-app-secret';
  const body = '{"event":"video.publish","object_id":"v1"}';

  it('accepts a valid HMAC-SHA256 signature inside the window', () => {
    const t = '1716192000';
    const sig = createHmac('sha256', secret)
      .update(`${t}.${body}`)
      .digest('hex');
    const out = verifyTikTokWebhook({
      headers: { 'X-TT-Signature': `t=${t},sig=${sig}` },
      body,
      appSecret: secret,
      toleranceSec: 600,
      nowSec: () => 1716192100,
    });
    expect(out.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const t = '1716192000';
    const sig = createHmac('sha256', secret)
      .update(`${t}.${body}`)
      .digest('hex');
    const out = verifyTikTokWebhook({
      headers: { 'X-TT-Signature': `t=${t},sig=${sig}` },
      body: body + 'x',
      appSecret: secret,
      toleranceSec: 600,
      nowSec: () => 1716192100,
    });
    expect(out.valid).toBe(false);
  });

  it('rejects a stale timestamp outside the tolerance window', () => {
    const t = '1716192000';
    const sig = createHmac('sha256', secret)
      .update(`${t}.${body}`)
      .digest('hex');
    const out = verifyTikTokWebhook({
      headers: { 'X-TT-Signature': `t=${t},sig=${sig}` },
      body,
      appSecret: secret,
      toleranceSec: 60,
      nowSec: () => 1716192000 + 600,
    });
    expect(out.valid).toBe(false);
    expect(out.reason).toBe('timestamp out of window');
  });
});
