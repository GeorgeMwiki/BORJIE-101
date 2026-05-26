/**
 * Twilio Voice X-Twilio-Signature verification tests.
 *
 * Reference: Twilio, *Validating Signatures from Twilio* —
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */

import { createHmac } from 'node:crypto';
import { describe, it, expect } from 'vitest';

import { verifyTwilioSignature, type WebhookBody } from '../ingest/webhook-receiver.js';

const AUTH_TOKEN = 'sub-account-auth-token';
const FULL_URL = 'https://borjie.example.com/webhooks/twilio-voice/status';

function signForm(url: string, params: Readonly<Record<string, string>>, token: string): string {
  const keys = Object.keys(params).sort();
  let s = url;
  for (const k of keys) {
    s += k + (params[k] ?? '');
  }
  return createHmac('sha1', token).update(s, 'utf8').digest('base64');
}

function signJson(url: string, body: string, token: string): string {
  return createHmac('sha1', token).update(url + body, 'utf8').digest('base64');
}

describe('voice/webhook', () => {
  it('accepts a correctly-signed form POST (status callback)', () => {
    const params: Record<string, string> = {
      CallSid: 'CA-xyz',
      CallStatus: 'completed',
      From: '+255700111222',
      To: '+255800111222',
    };
    const sig = signForm(FULL_URL, params, AUTH_TOKEN);
    const body: WebhookBody = { kind: 'form', params };
    const out = verifyTwilioSignature({
      fullUrl: FULL_URL,
      body,
      signatureHeader: sig,
      authToken: AUTH_TOKEN,
    });
    expect(out.ok).toBe(true);
  });

  it('rejects a tampered form POST (params re-ordered would still pass; value change does NOT)', () => {
    const params: Record<string, string> = {
      CallSid: 'CA-xyz',
      CallStatus: 'completed',
      From: '+255700111222',
      To: '+255800111222',
    };
    const sig = signForm(FULL_URL, params, AUTH_TOKEN);
    // tamper: change To
    const tampered = { ...params, To: '+255900999999' };
    const out = verifyTwilioSignature({
      fullUrl: FULL_URL,
      body: { kind: 'form', params: tampered },
      signatureHeader: sig,
      authToken: AUTH_TOKEN,
    });
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('mismatch');
  });

  it('rejects a forged signature with the wrong auth token', () => {
    const params: Record<string, string> = { CallSid: 'CA-1' };
    const sig = signForm(FULL_URL, params, 'WRONG-TOKEN');
    const out = verifyTwilioSignature({
      fullUrl: FULL_URL,
      body: { kind: 'form', params },
      signatureHeader: sig,
      authToken: AUTH_TOKEN,
    });
    expect(out.ok).toBe(false);
  });

  it('accepts a correctly-signed JSON body (recording callback)', () => {
    const rawBody = JSON.stringify({ RecordingSid: 'RE-xyz', CallSid: 'CA-xyz', RecordingUrl: 'https://api.twil.io/rec.wav' });
    const sig = signJson(FULL_URL, rawBody, AUTH_TOKEN);
    const out = verifyTwilioSignature({
      fullUrl: FULL_URL,
      body: { kind: 'json', rawBody },
      signatureHeader: sig,
      authToken: AUTH_TOKEN,
    });
    expect(out.ok).toBe(true);
  });

  it('rejects malformed signature header', () => {
    const out = verifyTwilioSignature({
      fullUrl: FULL_URL,
      body: { kind: 'form', params: {} },
      signatureHeader: '',
      authToken: AUTH_TOKEN,
    });
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.reason).toBe('malformed');
  });
});
