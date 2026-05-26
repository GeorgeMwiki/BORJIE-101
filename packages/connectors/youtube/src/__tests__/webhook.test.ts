import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyPushBody,
  verifySubscription,
} from '../ingest/webhook-receiver.js';

describe('verifySubscription', () => {
  it('echoes the hub.challenge when mode + topic match', () => {
    const out = verifySubscription({
      mode: 'subscribe',
      challenge: 'abc-123',
      topic: 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC1',
      expectedTopic:
        'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC1',
    });
    expect(out.accept).toBe(true);
    expect(out.challengeResponse).toBe('abc-123');
  });

  it('rejects when topic mismatches', () => {
    const out = verifySubscription({
      mode: 'subscribe',
      challenge: 'abc',
      topic: 'wrong',
      expectedTopic: 'right',
    });
    expect(out.accept).toBe(false);
  });
});

describe('verifyPushBody', () => {
  const secret = 'ytsecret';
  const body = '<feed>…</feed>';

  it('accepts a valid HMAC-SHA1 signature (PuSH spec)', () => {
    const sig =
      'sha1=' + createHmac('sha1', secret).update(body).digest('hex');
    const out = verifyPushBody({
      headers: { 'X-Hub-Signature': sig },
      body,
      secret,
    });
    expect(out.valid).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig =
      'sha1=' + createHmac('sha1', secret).update(body).digest('hex');
    const out = verifyPushBody({
      headers: { 'X-Hub-Signature': sig },
      body: body + 'x',
      secret,
    });
    expect(out.valid).toBe(false);
  });

  it('rejects missing signature header', () => {
    const out = verifyPushBody({ headers: {}, body, secret });
    expect(out.valid).toBe(false);
    expect(out.reason).toBe('missing signature header');
  });
});
