/**
 * GitHub webhook signature verification — `X-Hub-Signature-256`.
 *
 * Reference: GitHub, *Validating webhook deliveries* —
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 *
 * Header value format: `sha256=<hex>`. HMAC-SHA256 of the raw body
 * using the per-app webhook secret.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookVerifyParams {
  readonly rawBody: string;
  readonly signatureHeader: string; // 'sha256=…'
  readonly secret: string;
}

export type WebhookVerifyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'mismatch' | 'malformed' };

export function verifyGitHubWebhook(params: WebhookVerifyParams): WebhookVerifyOutcome {
  if (!params.signatureHeader.startsWith('sha256=')) {
    return { ok: false, reason: 'malformed' };
  }
  const provided = params.signatureHeader.slice('sha256='.length);
  if (!/^[0-9a-f]+$/i.test(provided)) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = createHmac('sha256', params.secret)
    .update(params.rawBody, 'utf8')
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
