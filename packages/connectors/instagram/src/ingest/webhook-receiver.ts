/**
 * Instagram Graph webhook receiver.
 *
 * Reference: Meta, *Webhooks for Instagram*,
 * https://developers.facebook.com/docs/instagram-api/guides/webhooks,
 * accessed 2026-05-25.
 *
 * Validates HMAC-SHA256 of the raw body with the app secret. Uses
 * timing-safe compare to defeat side channels.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookVerifyParams {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly appSecret: string;
}

export interface WebhookVerifyOutcome {
  readonly valid: boolean;
  readonly reason?: string;
}

const SIG_HEADER = 'x-hub-signature-256';

export function verifyInstagramWebhook(
  params: WebhookVerifyParams,
): WebhookVerifyOutcome {
  const sig = lookupHeader(params.headers, SIG_HEADER);
  if (!sig) {
    return Object.freeze({ valid: false, reason: 'missing signature header' });
  }
  // Header format: "sha256=<hex>"
  const prefix = 'sha256=';
  if (!sig.startsWith(prefix)) {
    return Object.freeze({ valid: false, reason: 'bad signature prefix' });
  }
  const hex = sig.slice(prefix.length);
  const expected = createHmac('sha256', params.appSecret)
    .update(params.body)
    .digest('hex');
  const a = Buffer.from(hex, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) {
    return Object.freeze({ valid: false, reason: 'length mismatch' });
  }
  const ok = timingSafeEqual(a, b);
  return Object.freeze({
    valid: ok,
    ...(ok ? {} : { reason: 'hmac mismatch' }),
  });
}

function lookupHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | null {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      return v ?? null;
    }
  }
  return null;
}
