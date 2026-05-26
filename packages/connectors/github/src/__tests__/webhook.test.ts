/**
 * GitHub webhook signature verification tests.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import { verifyGitHubWebhook } from '../ingest/webhook-receiver.js';

describe('github/webhook', () => {
  const secret = 'gh-app-webhook-secret';
  const body = '{"action":"opened","number":42}';

  it('accepts a valid sha256= signature', () => {
    const sig = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
    expect(verifyGitHubWebhook({ rawBody: body, signatureHeader: sig, secret }).ok).toBe(true);
  });

  it('rejects tampered body', () => {
    const sig = `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
    const o = verifyGitHubWebhook({ rawBody: `${body}!`, signatureHeader: sig, secret });
    expect(o.ok).toBe(false);
  });

  it('rejects missing sha256= prefix as malformed', () => {
    const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const o = verifyGitHubWebhook({ rawBody: body, signatureHeader: hex, secret });
    expect(o.ok).toBe(false);
    if (o.ok === false) expect(o.reason).toBe('malformed');
  });
});
