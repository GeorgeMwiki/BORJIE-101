/**
 * Parse rate-limit + retry-after headers from Anthropic / OpenAI.
 *
 * Anthropic emits:
 *   - `anthropic-ratelimit-requests-remaining`
 *   - `anthropic-ratelimit-requests-reset`     (RFC 3339 timestamp)
 *   - `anthropic-ratelimit-tokens-remaining`
 *   - `anthropic-ratelimit-tokens-reset`       (RFC 3339 timestamp)
 *
 * OpenAI emits:
 *   - `x-ratelimit-remaining-requests`
 *   - `x-ratelimit-reset-requests`              (duration like "1s", "300ms")
 *   - `x-ratelimit-remaining-tokens`
 *   - `x-ratelimit-reset-tokens`                (duration like "1s", "300ms")
 *
 * Both emit `retry-after` on 429s — either integer seconds (RFC 7231)
 * or an HTTP-date string.
 *
 * All parsers are tolerant of missing headers — we only update state
 * for the fields we successfully observed. The pre-flight gate falls
 * back to the previous value when a field is absent.
 */

import {
  type PreflightProvider,
  type ProviderRateLimitState,
  getMutableState,
} from './rate-limit-state.js';

/**
 * Minimal headers shape — works for both Web Fetch `Headers` and
 * plain-object dictionaries (e.g. axios). Anthropic / OpenAI SDK
 * errors carry both forms depending on transport.
 */
export interface HeadersLike {
  get(name: string): string | null;
}

/** True iff `value` looks like a real Fetch `Headers` instance. */
function isHeaders(value: unknown): value is Headers {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Headers).get === 'function'
  );
}

/** Wrap a plain-object dictionary in a `Headers`-shaped accessor. */
function wrapPlainHeaders(obj: Record<string, string>): HeadersLike {
  const norm = new Map<string, string>();
  for (const [k, v] of Object.entries(obj)) {
    norm.set(k.toLowerCase(), v);
  }
  return {
    get(name: string): string | null {
      return norm.get(name.toLowerCase()) ?? null;
    },
  };
}

function coerceHeaders(input: HeadersLike | Headers | Record<string, string> | undefined):
  | HeadersLike
  | undefined {
  if (!input) return undefined;
  if (isHeaders(input)) return input;
  if (typeof (input as HeadersLike).get === 'function') {
    return input as HeadersLike;
  }
  return wrapPlainHeaders(input as Record<string, string>);
}

/**
 * Parse a duration string like `"1s"` / `"300ms"` / `"500"` (seconds).
 * Returns ms; null on failure.
 */
function parseOpenAIDuration(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i.exec(value.trim());
  if (!m) return null;
  const n = Number.parseFloat(m[1]!);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? 's').toLowerCase();
  if (unit === 'ms') return Math.round(n);
  if (unit === 'm') return Math.round(n * 60_000);
  return Math.round(n * 1000);
}

function parseInt10(value: string): number | null {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function applyAnthropic(
  headers: HeadersLike,
  state: ProviderRateLimitState,
  now: number,
): void {
  const reqRemaining = headers.get('anthropic-ratelimit-requests-remaining');
  if (reqRemaining !== null) {
    const n = parseInt10(reqRemaining);
    if (n !== null) state.requestsRemaining = n;
  }
  const reqReset = headers.get('anthropic-ratelimit-requests-reset');
  if (reqReset !== null) {
    const ms = Date.parse(reqReset);
    if (Number.isFinite(ms)) state.requestsResetMs = ms;
  }
  const tokRemaining = headers.get('anthropic-ratelimit-tokens-remaining');
  if (tokRemaining !== null) {
    const n = parseInt10(tokRemaining);
    if (n !== null) state.tokensRemaining = n;
  }
  const tokReset = headers.get('anthropic-ratelimit-tokens-reset');
  if (tokReset !== null) {
    const ms = Date.parse(tokReset);
    if (Number.isFinite(ms)) state.tokensResetMs = ms;
  }
  state.lastObservedMs = now;
}

function applyOpenAI(
  headers: HeadersLike,
  state: ProviderRateLimitState,
  now: number,
): void {
  const reqRemaining = headers.get('x-ratelimit-remaining-requests');
  if (reqRemaining !== null) {
    const n = parseInt10(reqRemaining);
    if (n !== null) state.requestsRemaining = n;
  }
  const reqReset = headers.get('x-ratelimit-reset-requests');
  if (reqReset !== null) {
    const deltaMs = parseOpenAIDuration(reqReset);
    if (deltaMs !== null) state.requestsResetMs = now + deltaMs;
  }
  const tokRemaining = headers.get('x-ratelimit-remaining-tokens');
  if (tokRemaining !== null) {
    const n = parseInt10(tokRemaining);
    if (n !== null) state.tokensRemaining = n;
  }
  const tokReset = headers.get('x-ratelimit-reset-tokens');
  if (tokReset !== null) {
    const deltaMs = parseOpenAIDuration(tokReset);
    if (deltaMs !== null) state.tokensResetMs = now + deltaMs;
  }
  state.lastObservedMs = now;
}

/**
 * Update the in-process rate-limit state for `provider` from response
 * headers. Tolerant of missing/malformed values — only known-good
 * fields overwrite state.
 */
export function updateRateLimitFromHeaders(
  provider: PreflightProvider,
  headers: HeadersLike | Headers | Record<string, string> | undefined,
  now: () => number = Date.now,
): void {
  const h = coerceHeaders(headers);
  if (!h) return;
  const state = getMutableState(provider);
  const nowMs = now();
  if (provider === 'anthropic') {
    applyAnthropic(h, state, nowMs);
  } else if (provider === 'openai') {
    applyOpenAI(h, state, nowMs);
  }
}

/**
 * Parse `retry-after` header into ms. Returns `null` when absent or
 * malformed so the caller can pick a conservative default (e.g. 30s).
 * Capped at 5 minutes to prevent a runaway value from sidelining a
 * provider for hours.
 */
export function parseRetryAfterMs(
  headers: HeadersLike | Headers | Record<string, string> | undefined,
  now: () => number = Date.now,
): number | null {
  const h = coerceHeaders(headers);
  if (!h) return null;
  const v = h.get('retry-after');
  if (!v) return null;
  const FIVE_MIN_MS = 5 * 60 * 1000;
  // Integer seconds (RFC 7231)
  const seconds = parseInt10(v);
  if (seconds !== null && seconds >= 0) {
    return Math.min(seconds * 1000, FIVE_MIN_MS);
  }
  // HTTP-date
  const httpDate = Date.parse(v);
  if (Number.isFinite(httpDate)) {
    return Math.max(0, Math.min(httpDate - now(), FIVE_MIN_MS));
  }
  return null;
}
