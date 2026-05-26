/**
 * HubSpot v3 webhook signature verification tests.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';

import { verifyHubSpotWebhook } from '../ingest/webhook-receiver.js';

describe('hubspot/webhook', () => {
  const secret = 'app-secret';
  const method = 'POST' as const;
  const uri = 'https://borjie.example.com/integrations/hubspot/events';
  const body = '[{"objectId":1,"changeSource":"CRM"}]';
  const fixedNow = Date.parse('2026-01-01T00:00:00.000Z');
  const ts = String(fixedNow);

  function sigFor(b: string, t: string): string {
    return createHmac('sha256', secret)
      .update(`${method}${uri}${b}${t}`, 'utf8')
      .digest('base64');
  }

  it('accepts a valid v3 signature within the skew window', () => {
    const outcome = verifyHubSpotWebhook({
      method,
      uri,
      rawBody: body,
      timestamp: ts,
      signatureHeader: sigFor(body, ts),
      secret,
      nowMs: () => fixedNow,
    });
    expect(outcome.ok).toBe(true);
  });

  it('rejects mismatched signature', () => {
    const outcome = verifyHubSpotWebhook({
      method,
      uri,
      rawBody: body,
      timestamp: ts,
      signatureHeader: sigFor('{"tampered":true}', ts),
      secret,
      nowMs: () => fixedNow,
    });
    expect(outcome.ok).toBe(false);
  });

  it('rejects payloads outside the 5-minute skew window', () => {
    const outcome = verifyHubSpotWebhook({
      method,
      uri,
      rawBody: body,
      timestamp: ts,
      signatureHeader: sigFor(body, ts),
      secret,
      nowMs: () => fixedNow + 10 * 60 * 1000,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) expect(outcome.reason).toBe('replay-window');
  });
});
