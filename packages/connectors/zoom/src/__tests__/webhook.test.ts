/**
 * Zoom webhook signature + URL-validation tests.
 */

import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';

import { verifyZoomWebhook, tryUrlValidationEcho } from '../ingest/webhook-receiver.js';

const SECRET = 'webhook-secret-token-32-bytes-padded';

function signed(body: string, timestamp: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(`v0:${timestamp}:${body}`, 'utf8').digest('hex');
  return `v0=${mac}`;
}

describe('zoom/webhook', () => {
  it('accepts a fresh, correctly-signed event (timing-safe)', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ event: 'meeting.ended', payload: { object: { id: 1 } } });
    const sig = signed(body, ts, SECRET);
    const out = verifyZoomWebhook({
      rawBody: body,
      signatureHeader: sig,
      timestampHeader: ts,
      secret: SECRET,
      nowMs: Date.now(),
    });
    expect(out.ok).toBe(true);
  });

  it('rejects HMAC mismatch', () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"event":"meeting.ended"}';
    const sig = signed(body, ts, 'WRONG-SECRET');
    const out = verifyZoomWebhook({
      rawBody: body,
      signatureHeader: sig,
      timestampHeader: ts,
      secret: SECRET,
      nowMs: Date.now(),
    });
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('mismatch');
  });

  it('rejects replays older than the skew window', () => {
    const oldTs = String(Math.floor((Date.now() - 30 * 60 * 1000) / 1000));
    const body = '{"event":"meeting.ended"}';
    const sig = signed(body, oldTs, SECRET);
    const out = verifyZoomWebhook({
      rawBody: body,
      signatureHeader: sig,
      timestampHeader: oldTs,
      secret: SECRET,
      nowMs: Date.now(),
    });
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('replayed');
  });

  it('tryUrlValidationEcho returns plainToken + HMAC for the handshake', () => {
    const resp = tryUrlValidationEcho({
      event: 'endpoint.url_validation',
      plainToken: 'verify-this-token',
      secret: SECRET,
    });
    expect(resp).not.toBeNull();
    expect(resp?.plainToken).toBe('verify-this-token');
    expect(resp?.encryptedToken).toBe(
      createHmac('sha256', SECRET).update('verify-this-token', 'utf8').digest('hex'),
    );
  });

  it('tryUrlValidationEcho returns null for non-validation events', () => {
    const resp = tryUrlValidationEcho({
      event: 'meeting.ended',
      plainToken: 'x',
      secret: SECRET,
    });
    expect(resp).toBeNull();
  });
});
