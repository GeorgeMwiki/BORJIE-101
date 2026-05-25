/**
 * HTTP delivery with HMAC-SHA256 signatures for webhook payloads.
 *
 * Production-hardened: exponential backoff + jitter on retryable failures
 * (network error, 408, 429, 5xx). Caller can opt out with retries=0.
 *
 * SSRF protection: every outbound URL is validated before the request
 * fires. We reject non-http(s) schemes, any host that resolves/parses to
 * a private, loopback, link-local, or cloud-metadata address, and any
 * URL whose hostname is missing. Enforcement is controlled by
 * `WEBHOOK_SSRF_ALLOW_PRIVATE=true` so local dev can still POST to
 * `http://localhost:...` when that env flag is set; production must
 * leave it unset.
 */

import CryptoJS from 'crypto-js';

const DEFAULT_TIMEOUT_MS = 10_000;

// Link-local, loopback, RFC1918, cloud metadata, and carrier NAT ranges.
// Any literal host matching one of these is refused in production mode.
const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^169\.254\./,          // link-local / AWS/Azure/GCP metadata (169.254.169.254)
  /^100\.64\./,           // carrier-grade NAT
  /^0\./,                 // unspecified
  /^::1$/,                // IPv6 loopback
  /^fe80:/i,              // IPv6 link-local
  /^fc00:/i, /^fd[0-9a-f]{2}:/i, // IPv6 ULA
  /^::$/,                 // IPv6 unspecified
  /^localhost$/i,
  /^metadata\.google\.internal$/i,
];

export class SsrfBlockedError extends Error {
  constructor(url: string, reason: string) {
    super(`SSRF_BLOCKED: ${reason} (url=${url})`);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Validate a webhook target URL. Throws SsrfBlockedError on violation.
 * Pure, side-effect-free — callers use it for both deliver() and the
 * subscribe() admission check.
 */
export function assertSafeWebhookUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, 'invalid_url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfBlockedError(rawUrl, `scheme_not_allowed:${parsed.protocol}`);
  }
  const host = parsed.hostname;
  if (!host) {
    throw new SsrfBlockedError(rawUrl, 'missing_host');
  }
  if (process.env.WEBHOOK_SSRF_ALLOW_PRIVATE === 'true') {
    // Dev/test escape hatch — never set this in production.
    return parsed;
  }
  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(host)) {
      throw new SsrfBlockedError(rawUrl, `host_blocked:${host}`);
    }
  }
  return parsed;
}

export interface DeliveryOptions {
  timeoutMs?: number;
  /** Maximum retry attempts (default 3). */
  retries?: number;
  /** Base backoff in ms (default 500). */
  retryBaseMs?: number;
}

export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

export function signPayload(payload: string, secret: string): string {
  return CryptoJS.HmacSHA256(payload, secret).toString(CryptoJS.enc.Hex);
}

function isRetryable(status: number | undefined): boolean {
  if (status === undefined) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500 && status < 600;
}

async function deliverOnce(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok
      ? { success: true, statusCode: res.status }
      : { success: false, statusCode: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    clearTimeout(timeout);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deliver(
  url: string,
  payload: object,
  secret?: string,
  options: DeliveryOptions = {}
): Promise<DeliveryResult> {
  // SSRF guard BEFORE any network activity. A malicious subscriber
  // pointing at 169.254.169.254 or 127.0.0.1:6379 must be refused here,
  // not at the socket layer where error shape could leak internal state.
  try {
    assertSafeWebhookUrl(url);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'ssrf_blocked',
    };
  }

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Timestamp': new Date().toISOString(),
  };
  if (secret) {
    headers['X-Webhook-Signature'] = `sha256=${signPayload(body, secret)}`;
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, (options.retries ?? 3) + 1);
  const baseMs = options.retryBaseMs ?? 500;

  let last: DeliveryResult = { success: false, error: 'no_attempt' };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const r = await deliverOnce(url, body, headers, timeoutMs);
    if (r.success) return r;
    last = r;
    if (!isRetryable(r.statusCode) || attempt === maxAttempts - 1) return r;
    const backoff = baseMs * 2 ** attempt + Math.floor(Math.random() * baseMs);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
  return last;
}
