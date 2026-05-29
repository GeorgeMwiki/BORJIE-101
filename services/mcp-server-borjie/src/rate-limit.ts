/**
 * Per-scope rate limiting for MCP tool calls.
 *
 * Token-bucket per (token_id, scope) tuple. Buckets refill at a per-
 * scope-per-minute rate. On limit hit the dispatcher returns JSON-RPC
 * error code `-32099` (custom) with a `retry_after_seconds` payload —
 * mirroring `Retry-After` HTTP semantics so MCP clients render a
 * structured back-off prompt to the agent.
 *
 * Defaults are sourced from the capability manifest so the agent can
 * read them via /.well-known/borjie-capabilities.json and pace itself.
 *
 * Pure data structure; the api-gateway adapter feeds it from request
 * middleware so the rate-limit decision is co-located with all other
 * authorisation work.
 */

import type { BorjieScope } from './types.js';

export const RATE_LIMIT_EXCEEDED_CODE = -32099;

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export interface RateLimitConfig {
  /** Capacity (max tokens in the bucket). */
  readonly capacity: number;
  /** Refill tokens per minute. */
  readonly refillPerMinute: number;
}

export interface RateLimiter {
  check(tokenId: string, scope: BorjieScope): RateLimitDecision;
}

const DEFAULT_LIMITS: Readonly<Record<BorjieScope, RateLimitConfig>> = Object.freeze({
  'owner:read': { capacity: 120, refillPerMinute: 120 },
  'owner:write': { capacity: 30, refillPerMinute: 30 },
  'owner:draft': { capacity: 50, refillPerMinute: 30 },
  'owner:reminders': { capacity: 30, refillPerMinute: 30 },
  'owner:share': { capacity: 10, refillPerMinute: 10 },
  'admin:read': { capacity: 60, refillPerMinute: 60 },
});

export const DEFAULT_RATE_LIMITS: Readonly<Record<BorjieScope, RateLimitConfig>> =
  DEFAULT_LIMITS;

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimiterOptions {
  readonly limits?: Readonly<Partial<Record<BorjieScope, RateLimitConfig>>>;
  readonly now?: () => number;
}

export function createTokenBucketRateLimiter(
  options: RateLimiterOptions = {},
): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const merged: Record<BorjieScope, RateLimitConfig> = {
    ...DEFAULT_LIMITS,
    ...(options.limits ?? {}),
  } as Record<BorjieScope, RateLimitConfig>;
  const buckets = new Map<string, BucketState>();

  function key(tokenId: string, scope: BorjieScope): string {
    return `${tokenId}::${scope}`;
  }

  const limiter: RateLimiter = {
    check(tokenId: string, scope: BorjieScope): RateLimitDecision {
      const cfg = merged[scope];
      if (!cfg) return Object.freeze({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
      const k = key(tokenId, scope);
      const current =
        buckets.get(k) ?? { tokens: cfg.capacity, lastRefillMs: now() };
      const nowMs = now();
      const elapsedSec = Math.max(0, (nowMs - current.lastRefillMs) / 1_000);
      const refill = (cfg.refillPerMinute / 60) * elapsedSec;
      const refilled = Math.min(cfg.capacity, current.tokens + refill);
      if (refilled >= 1) {
        const next = { tokens: refilled - 1, lastRefillMs: nowMs };
        buckets.set(k, next);
        return Object.freeze({
          allowed: true,
          remaining: Math.floor(next.tokens),
          retryAfterSeconds: 0,
        });
      }
      // Compute time until we recover 1 token.
      const needed = 1 - refilled;
      const secondsPerToken = 60 / cfg.refillPerMinute;
      const retryAfterSeconds = Math.ceil(needed * secondsPerToken);
      buckets.set(k, { tokens: refilled, lastRefillMs: nowMs });
      return Object.freeze({
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      });
    },
  };
  return Object.freeze(limiter);
}
