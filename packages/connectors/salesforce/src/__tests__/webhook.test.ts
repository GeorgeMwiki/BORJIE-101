/**
 * Salesforce webhook signature verification tests.
 *
 * HMAC-SHA256 over the raw body, hex-encoded. Timing-safe compare.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import { verifySalesforceWebhook } from '../ingest/webhook-receiver.js';

describe('salesforce/webhook', () => {
  const secret = 'shared-secret-for-tenant-mwikila';
  const body = '{"event":"sobject.updated","Id":"001xx0000000ABCAA0"}';

  it('accepts a valid hex HMAC signature', () => {
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const outcome = verifySalesforceWebhook({
      rawBody: body,
      signatureHeader: sig,
      secret,
    });
    expect(outcome.ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    const outcome = verifySalesforceWebhook({
      rawBody: `${body}-tampered`,
      signatureHeader: sig,
      secret,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect(outcome.reason).toBe('mismatch');
    }
  });

  it('rejects a malformed signature header', () => {
    const outcome = verifySalesforceWebhook({
      rawBody: body,
      signatureHeader: 'not-hex!!',
      secret,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect(outcome.reason).toBe('malformed');
    }
  });
});
