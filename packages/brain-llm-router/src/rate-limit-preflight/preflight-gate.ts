/**
 * Pre-flight gate — throws BEFORE we burn a network request when the
 * rate-limit window is nearly exhausted.
 *
 * Throws `RateLimitNearExhaustionError` (distinct from a 429 response)
 * so the fallback loop can decide whether to:
 *   - skip this provider and burst to the next (typical hot-path), OR
 *   - wait for `resetAt` and retry the same provider (low-priority work).
 *
 * The gate is `noop` until headers have been observed from a previous
 * call — counters start at `Infinity`. After the reset window passes,
 * the floor is considered stale; the next request goes through and
 * refreshes counters from the response headers.
 *
 * **CRITICAL**: this gate trips at `<=1` rather than `0` because a
 * concurrent caller may have already claimed the last request.
 */

import {
  type PreflightProvider,
  getMutableState,
} from './rate-limit-state.js';
import { parseRetryAfterMs, type HeadersLike } from './header-parser.js';

export class RateLimitNearExhaustionError extends Error {
  public readonly provider: PreflightProvider;
  public readonly resetAtMs: number;
  constructor(provider: PreflightProvider, resetAtMs: number) {
    super(
      `[rate-limit-preflight] ${provider} rate limit near exhaustion; ` +
        `resets at ${new Date(resetAtMs).toISOString()}`,
    );
    this.name = 'RateLimitNearExhaustionError';
    this.provider = provider;
    this.resetAtMs = resetAtMs;
  }
}

/**
 * Check the pre-flight floor for `provider`. Throws if we know the
 * window is almost empty; noop otherwise.
 *
 * Stale-window detection: if `now >= resetAt` for both counters, the
 * floor is considered stale and we let the call through.
 */
export function checkRateLimitFloor(
  provider: PreflightProvider,
  now: () => number = Date.now,
): void {
  const state = getMutableState(provider);
  const nowMs = now();

  // If both reset windows have elapsed, the floor is stale — let the
  // next request through. Counters will be refreshed from the response.
  const requestsStale =
    state.requestsResetMs > 0 && nowMs >= state.requestsResetMs;
  const tokensStale = state.tokensResetMs > 0 && nowMs >= state.tokensResetMs;

  if (
    state.requestsRemaining <= 1 &&
    state.requestsResetMs > 0 &&
    !requestsStale
  ) {
    throw new RateLimitNearExhaustionError(provider, state.requestsResetMs);
  }
  if (
    state.tokensRemaining <= 1 &&
    state.tokensResetMs > 0 &&
    !tokensStale
  ) {
    throw new RateLimitNearExhaustionError(provider, state.tokensResetMs);
  }
}

/**
 * Pull `retry-after` ms off an SDK error object. Tolerant of both real
 * `Headers` instances (Anthropic / OpenAI SDK >=0.40) and plain
 * dictionaries (older fetch-based errors).
 */
export function extractRetryAfterMsFromError(
  err: unknown,
): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const maybe = err as {
    headers?: HeadersLike | Headers | Record<string, string>;
  };
  const h = maybe.headers;
  if (!h) return undefined;
  const ms = parseRetryAfterMs(h);
  return ms ?? undefined;
}
