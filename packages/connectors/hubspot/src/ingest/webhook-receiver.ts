/**
 * HubSpot v3 webhook signature verification.
 *
 * Reference: HubSpot, *Webhooks API — Signature validation* —
 * https://developers.hubspot.com/docs/api/webhooks/validating-requests
 *
 * The v3 scheme HMAC-SHA256s the canonical string
 *   method + uri + body + timestamp
 * and base64-encodes the digest. Header `X-HubSpot-Signature-v3`.
 *
 * The skew window is 5 minutes; older requests are rejected to
 * stop replays.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookVerifyParams {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly uri: string; // fully-qualified URL (https://…)
  readonly rawBody: string;
  readonly timestamp: string; // header `X-HubSpot-Request-Timestamp` (ms epoch)
  readonly signatureHeader: string; // base64
  readonly secret: string;
  readonly nowMs?: () => number;
  readonly maxSkewMs?: number;
}

export type WebhookVerifyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'mismatch' | 'malformed' | 'replay-window' };

const DEFAULT_SKEW_MS = 5 * 60 * 1000;

export function verifyHubSpotWebhook(
  params: WebhookVerifyParams,
): WebhookVerifyOutcome {
  const ts = Number(params.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'malformed' };
  const now = params.nowMs?.() ?? Date.now();
  const skew = params.maxSkewMs ?? DEFAULT_SKEW_MS;
  if (Math.abs(now - ts) > skew) {
    return { ok: false, reason: 'replay-window' };
  }
  const canonical = `${params.method}${params.uri}${params.rawBody}${params.timestamp}`;
  const expectedB64 = createHmac('sha256', params.secret)
    .update(canonical, 'utf8')
    .digest('base64');
  const a = Buffer.from(expectedB64);
  const b = Buffer.from(params.signatureHeader);
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
