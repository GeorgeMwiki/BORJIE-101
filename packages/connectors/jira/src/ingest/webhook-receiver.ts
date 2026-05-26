/**
 * Jira (Connect) webhook signature verification.
 *
 * Reference: Atlassian, *Webhooks* —
 * https://developer.atlassian.com/cloud/jira/platform/webhooks/
 *
 * Connect apps sign with HMAC-SHA256; 3LO OAuth apps may omit
 * signing — for those the caller relies on source-IP allowlist
 * and TLS instead and bypasses this check.
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

export function verifyJiraWebhook(params: WebhookVerifyParams): WebhookVerifyOutcome {
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
