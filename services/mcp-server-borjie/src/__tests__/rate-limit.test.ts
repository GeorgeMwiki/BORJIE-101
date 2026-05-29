import { describe, it, expect } from 'vitest';
import {
  createTokenBucketRateLimiter,
  DEFAULT_RATE_LIMITS,
} from '../rate-limit.js';
import { createDispatcher } from '../dispatcher.js';
import type { BorjieMcpAuthContext } from '../types.js';
import type { GatewayClient, GatewayCallInput } from '../gateway-client.js';

function authFor(): BorjieMcpAuthContext {
  return Object.freeze({
    tenantId: 't1',
    ownerId: 'o1',
    agentName: 'rl-agent',
    agentTokenId: 'tok-rl',
    scopes: ['owner:read'],
    issuedAt: 0,
    expiresAt: 1_000_000,
    correlationId: 'corr-1',
  });
}

function fakeGateway(): GatewayClient {
  return Object.freeze({
    async call<T>(_input: GatewayCallInput): Promise<T> {
      return {} as T;
    },
  });
}

describe('token bucket', () => {
  it('allows up to capacity, then denies', () => {
    let t = 0;
    const limiter = createTokenBucketRateLimiter({
      limits: { 'owner:read': { capacity: 2, refillPerMinute: 0 } },
      now: () => t,
    });
    expect(limiter.check('tok', 'owner:read').allowed).toBe(true);
    expect(limiter.check('tok', 'owner:read').allowed).toBe(true);
    expect(limiter.check('tok', 'owner:read').allowed).toBe(false);
  });

  it('refills over time', () => {
    let t = 0;
    const limiter = createTokenBucketRateLimiter({
      limits: { 'owner:read': { capacity: 1, refillPerMinute: 60 } },
      now: () => t,
    });
    expect(limiter.check('tok', 'owner:read').allowed).toBe(true);
    expect(limiter.check('tok', 'owner:read').allowed).toBe(false);
    t += 1_500; // 1.5 seconds — one token refilled
    expect(limiter.check('tok', 'owner:read').allowed).toBe(true);
  });

  it('exports sensible defaults', () => {
    expect(DEFAULT_RATE_LIMITS['owner:read'].capacity).toBe(120);
    expect(DEFAULT_RATE_LIMITS['owner:write'].refillPerMinute).toBeGreaterThan(0);
  });
});

describe('dispatcher rate limiting', () => {
  it('returns -32099 when the bucket is empty', async () => {
    let t = 0;
    const limiter = createTokenBucketRateLimiter({
      limits: { 'owner:read': { capacity: 1, refillPerMinute: 0 } },
      now: () => t,
    });
    const d = createDispatcher({
      gatewayClient: fakeGateway(),
      async killSwitchOpen() {
        return false;
      },
      async auditChainHash() {
        return 'h';
      },
      async resolveAuthContext() {
        return authFor();
      },
      rateLimiter: limiter,
    });
    const ok = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'mining_drafts_list', arguments: {} },
      },
      bearerToken: 'tok',
    });
    expect('result' in ok).toBe(true);
    const denied = await d.dispatch({
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'mining_drafts_list', arguments: {} },
      },
      bearerToken: 'tok',
    });
    expect('error' in denied).toBe(true);
    if ('error' in denied) {
      expect(denied.error.code).toBe(-32099);
      expect(denied.error.data).toEqual({ retry_after_seconds: expect.any(Number) });
    }
  });
});
