/**
 * TikTok Business API webhook receiver (sandbox + opt-in prod).
 *
 * Reference: TikTok Business API, *Webhook Events*,
 * https://business-api.tiktok.com/portal/docs?id=1738455508553729,
 * accessed 2026-05-25.
 *
 * Validates HMAC-SHA256 of the raw body with the app secret (TikTok
 * uses the `x-tt-signature` header with the format `t=<unix>,sig=<hex>`
 * for verifying webhook authenticity).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookVerifyParams {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly appSecret: string;
  /** Allowed clock skew in seconds (default 300). */
  readonly toleranceSec?: number;
  readonly nowSec?: () => number;
}

export interface WebhookVerifyOutcome {
  readonly valid: boolean;
  readonly reason?: string;
}

const SIG_HEADER = 'x-tt-signature';

export function verifyTikTokWebhook(
  params: WebhookVerifyParams,
): WebhookVerifyOutcome {
  const sigHeader = lookupHeader(params.headers, SIG_HEADER);
  if (!sigHeader) {
    return Object.freeze({ valid: false, reason: 'missing signature header' });
  }
  const parts = sigHeader.split(',').reduce<Record<string, string>>(
    (acc, pair) => {
      const [k, v] = pair.split('=');
      if (k && v) acc[k.trim()] = v.trim();
      return acc;
    },
    {},
  );
  const t = parts['t'];
  const sig = parts['sig'];
  if (!t || !sig) {
    return Object.freeze({ valid: false, reason: 'malformed signature' });
  }
  const tNum = Number(t);
  if (!Number.isFinite(tNum)) {
    return Object.freeze({ valid: false, reason: 'malformed timestamp' });
  }
  const now = params.nowSec?.() ?? Math.floor(Date.now() / 1000);
  const tol = params.toleranceSec ?? 300;
  if (Math.abs(now - tNum) > tol) {
    return Object.freeze({ valid: false, reason: 'timestamp out of window' });
  }
  const expected = createHmac('sha256', params.appSecret)
    .update(`${t}.${params.body}`)
    .digest('hex');
  const a = Buffer.from(sig, 'hex');
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
