/**
 * Linear webhook signature verification tests.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import { verifyLinearWebhook } from '../ingest/webhook-receiver.js';

describe('linear/webhook', () => {
  const secret = 'linear-app-secret';
  const body = '{"type":"Issue","action":"update","data":{"id":"lin-1"}}';

  it('accepts a valid signature', () => {
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyLinearWebhook({ rawBody: body, signatureHeader: sig, secret }).ok).toBe(true);
  });

  it('rejects tampered body', () => {
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const o = verifyLinearWebhook({ rawBody: `${body}+tamper`, signatureHeader: sig, secret });
    expect(o.ok).toBe(false);
  });

  it('rejects malformed signature header', () => {
    const o = verifyLinearWebhook({ rawBody: body, signatureHeader: 'not-hex!', secret });
    expect(o.ok).toBe(false);
    if (o.ok === false) expect(o.reason).toBe('malformed');
  });
});
