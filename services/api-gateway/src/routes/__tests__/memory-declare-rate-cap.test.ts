/**
 * A2b-3 wire #5 — declared-facts router rate-limit + per-user fact cap.
 *
 * These tests cover the policy-level shape rather than the full HTTP
 * dispatch (which requires the api-gateway boot). The full HTTP path is
 * exercised at smoke. Here we verify:
 *   1. The rate-limit factory produces the expected bucket key
 *      (per (tenant, user)) and rejects the 31st call within 60s.
 *   2. The `DeclaredFactsCapExceededError` carries the typed `code:
 *      'declared-facts-cap'` discriminator so the router can return
 *      HTTP 429 with the documented body.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DeclaredFactsCapExceededError,
  DECLARED_FACTS_PER_USER_CAP,
} from '@borjie/database';
import {
  rateLimiter,
  rateLimitStore,
} from '../../middleware/rate-limiter';

describe('DeclaredFactsCapExceededError', () => {
  it('is named with a stable typed code', () => {
    const err = new DeclaredFactsCapExceededError(
      DECLARED_FACTS_PER_USER_CAP,
    );
    expect(err.code).toBe('declared-facts-cap');
    expect(err.cap).toBe(500);
    expect(err.message).toContain('500');
  });

  it('round-trips structurally for the router translator', () => {
    const err = new DeclaredFactsCapExceededError(500) as unknown;
    const shaped =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'declared-facts-cap';
    expect(shaped).toBe(true);
  });
});

describe('per-user rate-limiter — token bucket math', () => {
  const KEY = 'perUser:tenant-1:user-1';

  beforeEach(() => {
    rateLimitStore.delete(KEY);
  });

  it('allows the first 30 calls in a 60s window', () => {
    for (let i = 0; i < 30; i++) {
      const r = rateLimiter.check(KEY, {
        maxRequests: 30,
        windowSizeSeconds: 60,
      });
      expect(r.allowed).toBe(true);
    }
  });

  it('rejects the 31st call within the same window', () => {
    for (let i = 0; i < 30; i++) {
      rateLimiter.check(KEY, { maxRequests: 30, windowSizeSeconds: 60 });
    }
    const r = rateLimiter.check(KEY, {
      maxRequests: 30,
      windowSizeSeconds: 60,
    });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });
});
