/**
 * Twilio Voice webhook signature verification — `X-Twilio-Signature`.
 *
 * Reference: Twilio, *Validating Signatures from Twilio* —
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * Algorithm: HMAC-SHA1, base64-encoded, of:
 *   FULL_URL  +  for each sorted POST param: KEY + VALUE
 *
 * "FULL_URL" is the URL Twilio POSTed to (including query string if
 * any), exactly as configured in the Twilio console. The verifier must
 * receive that same URL from the application layer (it is NOT
 * reconstructed from the HTTP host header).
 *
 * For JSON-bodied webhooks (newer Twilio products), the body itself is
 * appended to the URL with no sorting. We support both shapes via
 * the `bodyKind` discriminator.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type WebhookBody =
  | { readonly kind: 'form'; readonly params: Readonly<Record<string, string>> }
  | { readonly kind: 'json'; readonly rawBody: string };

export interface WebhookVerifyParams {
  readonly fullUrl: string;
  readonly body: WebhookBody;
  readonly signatureHeader: string; // base64 of HMAC-SHA1
  readonly authToken: string;
}

export type WebhookVerifyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'mismatch' | 'malformed' };

export function verifyTwilioSignature(params: WebhookVerifyParams): WebhookVerifyOutcome {
  if (params.signatureHeader === '') return { ok: false, reason: 'malformed' };

  let signedString = params.fullUrl;
  if (params.body.kind === 'form') {
    const keys = Object.keys(params.body.params).sort();
    for (const k of keys) {
      const v = params.body.params[k];
      signedString += k + (v ?? '');
    }
  } else {
    signedString += params.body.rawBody;
  }

  const expected = createHmac('sha1', params.authToken).update(signedString, 'utf8').digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(params.signatureHeader);
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
