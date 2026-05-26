/**
 * Zoom webhook signature verification — `x-zm-signature`.
 *
 * Reference: Zoom, *Webhook signature verification* —
 * https://developers.zoom.us/docs/api/rest/webhook-reference/#verify-webhook-events
 *
 * Header value format: `v0=<hex>`.
 * Signed message: `v0:{x-zm-request-timestamp}:{rawBody}`.
 * HMAC-SHA256 with the secret token configured in the Zoom App.
 *
 * Replay protection: reject events with timestamps older than the
 * configured skew window (default 5 minutes).
 *
 * URL validation events (`event === 'endpoint.url_validation'`) are
 * handled separately via `tryUrlValidationEcho`, which returns the
 * `plainToken` + its SHA-256 HMAC for the verification handshake.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookVerifyParams {
  readonly rawBody: string;
  readonly signatureHeader: string; // 'v0=…'
  readonly timestampHeader: string; // x-zm-request-timestamp (epoch seconds)
  readonly secret: string;
  readonly nowMs: number;
  readonly maxSkewMs?: number;
}

export type WebhookVerifyOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'mismatch' | 'malformed' | 'replayed' };

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

export function verifyZoomWebhook(params: WebhookVerifyParams): WebhookVerifyOutcome {
  if (!params.signatureHeader.startsWith('v0=')) return { ok: false, reason: 'malformed' };
  const provided = params.signatureHeader.slice('v0='.length);
  if (!/^[0-9a-f]+$/i.test(provided)) return { ok: false, reason: 'malformed' };
  const tsNum = Number(params.timestampHeader);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'malformed' };
  const skew = params.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Math.abs(params.nowMs - tsNum * 1000) > skew) {
    return { ok: false, reason: 'replayed' };
  }
  const message = `v0:${params.timestampHeader}:${params.rawBody}`;
  const expected = createHmac('sha256', params.secret).update(message, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

export interface UrlValidationParams {
  readonly event: string;
  readonly plainToken: string;
  readonly secret: string;
}

export interface UrlValidationResponse {
  readonly plainToken: string;
  readonly encryptedToken: string;
}

/** Returns the validation response payload Zoom expects (within 3s). */
export function tryUrlValidationEcho(params: UrlValidationParams): UrlValidationResponse | null {
  if (params.event !== 'endpoint.url_validation') return null;
  const encrypted = createHmac('sha256', params.secret)
    .update(params.plainToken, 'utf8')
    .digest('hex');
  return { plainToken: params.plainToken, encryptedToken: encrypted };
}
