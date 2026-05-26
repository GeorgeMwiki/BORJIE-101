/**
 * Jira webhook signature verification tests.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import { verifyJiraWebhook } from '../ingest/webhook-receiver.js';

describe('jira/webhook', () => {
  const secret = 'jira-app-secret';
  const body = '{"webhookEvent":"jira:issue_updated","issue":{"id":"10001"}}';

  it('accepts a valid signature', () => {
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(verifyJiraWebhook({ rawBody: body, signatureHeader: sig, secret }).ok).toBe(true);
  });

  it('rejects tampered body', () => {
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const o = verifyJiraWebhook({ rawBody: `${body}!`, signatureHeader: sig, secret });
    expect(o.ok).toBe(false);
  });

  it('rejects malformed signature header', () => {
    const o = verifyJiraWebhook({ rawBody: body, signatureHeader: 'not-hex!', secret });
    expect(o.ok).toBe(false);
    if (o.ok === false) expect(o.reason).toBe('malformed');
  });
});
