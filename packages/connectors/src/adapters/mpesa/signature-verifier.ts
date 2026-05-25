/**
 * M-Pesa Daraja 3.0 — webhook origin verification.
 *
 * Safaricom does NOT sign callbacks with HMAC the way Stripe / Twilio do.
 * Production deployments protect the callback endpoint using a combination
 * of:
 *   1. IP allow-list (Safaricom publishes their Daraja egress ranges).
 *   2. A shared `secretToken` embedded in the callback URL path or query
 *      (e.g. `https://api.borjie.co.ke/webhooks/mpesa/stk/<token>`),
 *      bound to a tenant + rotated per env.
 *   3. Defence-in-depth: reject any callback whose `CheckoutRequestID`
 *      does not match a known in-flight push.
 *
 * This module implements (1) and (2) — IP allow-listing and constant-time
 * shared-token comparison. The match against known `CheckoutRequestID`
 * lives in the webhook handler (caller-injected lookup).
 *
 * Use `verifyMpesaWebhookOrigin(request, opts)` from any HTTP framework
 * adapter (Express / Fastify / Next / Hono / etc.) — keeps the connector
 * pure of HTTP-framework concerns.
 */

import { timingSafeEqual } from 'node:crypto';

// ─────────────────────────────────────────────────────────────────────
// Safaricom Daraja production egress IP ranges (per Safaricom's published
// list as of 2026). Keep this list in source so deploys do not need a
// runtime fetch. Sandbox issues no ranges — sandbox skips IP check.
// ─────────────────────────────────────────────────────────────────────

export const SAFARICOM_PRODUCTION_IPS: readonly string[] = Object.freeze([
  '196.201.214.200',
  '196.201.214.206',
  '196.201.213.114',
  '196.201.214.207',
  '196.201.214.208',
  '196.201.213.44',
  '196.201.212.127',
  '196.201.212.138',
  '196.201.212.129',
  '196.201.212.136',
  '196.201.212.74',
  '196.201.212.69',
]);

// ─────────────────────────────────────────────────────────────────────
// Input shape — what a verifier needs from an inbound HTTP request
// ─────────────────────────────────────────────────────────────────────

export interface MpesaWebhookOriginRequest {
  /** Client IP — already extracted from `X-Forwarded-For` chain. */
  readonly remoteIp?: string;
  /**
   * Shared token presented by Daraja. Where this lives is deployment
   * choice — typical patterns:
   *   - last URL path segment: `/webhooks/mpesa/stk/<token>`
   *   - query param:           `?t=<token>`
   * Caller extracts whichever and passes the raw string here.
   */
  readonly presentedToken?: string;
}

export interface MpesaWebhookOriginOptions {
  /**
   * Expected shared token. Compared in constant time. Required.
   * Source from an env var like `MPESA_WEBHOOK_TOKEN`.
   */
  readonly expectedToken: string;
  /**
   * IP allow-list. When empty, IP check is skipped (sandbox). When
   * populated, request `remoteIp` MUST appear in the list.
   * Default: `SAFARICOM_PRODUCTION_IPS` (use `[]` for sandbox).
   */
  readonly allowedIps?: readonly string[];
}

export type VerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

// ─────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────

function constantTimeStringEqual(a: string, b: string): boolean {
  // `timingSafeEqual` requires equal-length buffers. Defend by padding.
  if (a.length !== b.length) {
    // Still do a comparison to keep timing flat.
    const padLen = Math.max(a.length, b.length, 1);
    const buf = Buffer.alloc(padLen);
    timingSafeEqual(Buffer.from(a.padEnd(padLen, '\0')), buf);
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Verify the inbound webhook originated from Safaricom Daraja. Returns
 * `{ ok: true }` only when BOTH the shared token matches AND (when an
 * IP allow-list is configured) the remote IP is on the list.
 *
 * Constant-time token comparison — does not leak token length or content
 * via timing side channels.
 */
export function verifyMpesaWebhookOrigin(
  req: MpesaWebhookOriginRequest,
  opts: MpesaWebhookOriginOptions,
): VerifyResult {
  if (!opts.expectedToken) {
    return { ok: false, reason: 'expectedToken not configured' };
  }
  if (!req.presentedToken) {
    return { ok: false, reason: 'presentedToken missing' };
  }
  if (!constantTimeStringEqual(req.presentedToken, opts.expectedToken)) {
    return { ok: false, reason: 'presentedToken does not match expected' };
  }

  const allowed = opts.allowedIps ?? SAFARICOM_PRODUCTION_IPS;
  if (allowed.length > 0) {
    if (!req.remoteIp) {
      return { ok: false, reason: 'remoteIp missing — required when allowedIps set' };
    }
    if (!allowed.includes(req.remoteIp)) {
      return { ok: false, reason: `remoteIp ${req.remoteIp} not on Safaricom allow-list` };
    }
  }

  return { ok: true };
}
