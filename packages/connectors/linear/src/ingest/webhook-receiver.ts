/**
 * Linear webhook signature verification.
 *
 * Header `Linear-Signature`: hex HMAC-SHA256 of the raw body using
 * the per-app secret.
 *
 * Reference: Linear, *Webhooks* —
 * https://developers.linear.app/docs/graphql/webhooks
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookVerifyParams {
  readonly rawBody: string;
  readonly signatureHeader: string; // hex hmac-sha256
  readonly secret: string;
}

export type WebhookVerifyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'mismatch' | 'malformed' };

export function verifyLinearWebhook(params: WebhookVerifyParams): WebhookVerifyOutcome {
  if (!/^[0-9a-f]+$/i.test(params.signatureHeader)) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = createHmac('sha256', params.secret)
    .update(params.rawBody, 'utf8')
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(params.signatureHeader, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
