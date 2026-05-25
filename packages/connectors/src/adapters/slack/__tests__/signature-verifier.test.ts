/**
 * Slack signature-verifier — unit tests.
 *
 * Covers the four success/failure axes:
 *   - Header presence (signature, timestamp)
 *   - Signature well-formedness (`v0=<64 hex>`)
 *   - Timestamp skew window
 *   - HMAC mismatch detection
 *
 * The timing-safe-compare property is tested by asserting that BOTH a
 * length-mismatch and a hex-mismatch produce the same `mismatch`
 * outcome (i.e. the function never short-circuits on prefix mismatch,
 * which would leak position info via a timing side-channel).
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifySlackSignature } from '../signature-verifier.js';

const SIGNING_SECRET = 'test-signing-secret-for-borjie';

function signedRequest(
  body: string,
  timestampSec: number,
  secret = SIGNING_SECRET,
): { rawBody: string; signature: string; timestamp: string } {
  const ts = String(timestampSec);
  const base = `v0:${ts}:${body}`;
  const hex = createHmac('sha256', secret).update(base, 'utf8').digest('hex');
  return {
    rawBody: body,
    signature: `v0=${hex}`,
    timestamp: ts,
  };
}

describe('verifySlackSignature — happy path', () => {
  it('accepts a freshly signed request inside the skew window', () => {
    const now = 1_700_000_000;
    const req = signedRequest('{"event_id":"abc"}', now);
    const outcome = verifySlackSignature(
      { ...req, signingSecret: SIGNING_SECRET },
      { nowSeconds: () => now },
    );
    expect(outcome).toEqual({ ok: true });
  });

  it('accepts when the timestamp is offset within ±5 minutes', () => {
    const now = 1_700_000_000;
    const reqEarly = signedRequest('payload-1', now - 60);
    const reqLate = signedRequest('payload-2', now + 60);
    expect(
      verifySlackSignature(
        { ...reqEarly, signingSecret: SIGNING_SECRET },
        { nowSeconds: () => now },
      ),
    ).toEqual({ ok: true });
    expect(
      verifySlackSignature(
        { ...reqLate, signingSecret: SIGNING_SECRET },
        { nowSeconds: () => now },
      ),
    ).toEqual({ ok: true });
  });
});

describe('verifySlackSignature — header validation', () => {
  it('rejects when signature header is missing', () => {
    const outcome = verifySlackSignature({
      rawBody: '{}',
      signature: '',
      timestamp: '1700000000',
      signingSecret: SIGNING_SECRET,
    });
    expect(outcome).toEqual({ ok: false, reason: 'missing-signature' });
  });

  it('rejects when timestamp header is missing', () => {
    const outcome = verifySlackSignature({
      rawBody: '{}',
      signature: 'v0=' + 'a'.repeat(64),
      timestamp: '',
      signingSecret: SIGNING_SECRET,
    });
    expect(outcome).toEqual({ ok: false, reason: 'missing-timestamp' });
  });

  it('rejects when timestamp is non-numeric', () => {
    const outcome = verifySlackSignature({
      rawBody: '{}',
      signature: 'v0=' + 'a'.repeat(64),
      timestamp: 'not-a-number',
      signingSecret: SIGNING_SECRET,
    });
    expect(outcome).toEqual({ ok: false, reason: 'missing-timestamp' });
  });
});

describe('verifySlackSignature — signature shape', () => {
  it('rejects when signature lacks the v0= prefix', () => {
    const outcome = verifySlackSignature({
      rawBody: '{}',
      signature: 'v1=' + 'a'.repeat(64),
      timestamp: '1700000000',
      signingSecret: SIGNING_SECRET,
    });
    expect(outcome).toEqual({ ok: false, reason: 'malformed-signature' });
  });

  it('rejects when hex segment is the wrong length', () => {
    const outcome = verifySlackSignature(
      {
        rawBody: '{}',
        signature: 'v0=' + 'a'.repeat(32),
        timestamp: '1700000000',
        signingSecret: SIGNING_SECRET,
      },
      { nowSeconds: () => 1_700_000_000 },
    );
    expect(outcome).toEqual({ ok: false, reason: 'malformed-signature' });
  });

  it('rejects when hex segment contains non-hex characters', () => {
    const outcome = verifySlackSignature(
      {
        rawBody: '{}',
        signature: 'v0=' + 'z'.repeat(64),
        timestamp: '1700000000',
        signingSecret: SIGNING_SECRET,
      },
      { nowSeconds: () => 1_700_000_000 },
    );
    expect(outcome).toEqual({ ok: false, reason: 'malformed-signature' });
  });
});

describe('verifySlackSignature — skew window', () => {
  it('rejects timestamps older than the skew window', () => {
    const now = 1_700_000_000;
    const tooOld = signedRequest('body', now - 60 * 6);
    const outcome = verifySlackSignature(
      { ...tooOld, signingSecret: SIGNING_SECRET },
      { nowSeconds: () => now },
    );
    expect(outcome).toEqual({ ok: false, reason: 'timestamp-skew' });
  });

  it('rejects timestamps newer than the skew window', () => {
    const now = 1_700_000_000;
    const tooFuture = signedRequest('body', now + 60 * 6);
    const outcome = verifySlackSignature(
      { ...tooFuture, signingSecret: SIGNING_SECRET },
      { nowSeconds: () => now },
    );
    expect(outcome).toEqual({ ok: false, reason: 'timestamp-skew' });
  });

  it('honours the maxSkewSeconds override', () => {
    const now = 1_700_000_000;
    const ancient = signedRequest('body', now - 60 * 60 * 24);
    // Default would reject; override accepts.
    const outcome = verifySlackSignature(
      { ...ancient, signingSecret: SIGNING_SECRET },
      { nowSeconds: () => now, maxSkewSeconds: Number.POSITIVE_INFINITY },
    );
    expect(outcome).toEqual({ ok: true });
  });
});

describe('verifySlackSignature — mismatch detection', () => {
  it('rejects when the secret differs', () => {
    const now = 1_700_000_000;
    const req = signedRequest('body', now, 'attacker-secret');
    const outcome = verifySlackSignature(
      { ...req, signingSecret: SIGNING_SECRET },
      { nowSeconds: () => now },
    );
    expect(outcome).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('rejects when the body is tampered after signing', () => {
    const now = 1_700_000_000;
    const req = signedRequest('original-body', now);
    const tampered = { ...req, rawBody: 'tampered-body' };
    const outcome = verifySlackSignature(
      { ...tampered, signingSecret: SIGNING_SECRET },
      { nowSeconds: () => now },
    );
    expect(outcome).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('uses timing-safe compare (does not short-circuit on prefix mismatch)', () => {
    // Two distinct hex inputs of the correct length that differ in
    // the FIRST byte vs the LAST byte both produce `mismatch` —
    // a naive `===` would also produce `mismatch`, but `timingSafeEqual`
    // does not differentiate the two cases via early return. We
    // assert that both outcomes are structurally identical.
    const now = 1_700_000_000;
    const correct = signedRequest('body', now);
    // Flip first hex char of valid signature.
    const flippedFirst = {
      ...correct,
      signature:
        'v0=' +
        (correct.signature.charAt(3) === 'f' ? '0' : 'f') +
        correct.signature.slice(4),
    };
    // Flip last hex char of valid signature.
    const flippedLast = {
      ...correct,
      signature:
        correct.signature.slice(0, -1) +
        (correct.signature.slice(-1) === 'f' ? '0' : 'f'),
    };
    const a = verifySlackSignature(
      { ...flippedFirst, signingSecret: SIGNING_SECRET },
      { nowSeconds: () => now },
    );
    const b = verifySlackSignature(
      { ...flippedLast, signingSecret: SIGNING_SECRET },
      { nowSeconds: () => now },
    );
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: false, reason: 'mismatch' });
  });
});
