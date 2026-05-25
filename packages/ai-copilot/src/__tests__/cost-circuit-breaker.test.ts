/**
 * Cost circuit breaker tests — Wave-11.
 */

import { describe, it, expect } from 'vitest';
import { createCostCircuitBreaker } from '../security/cost-circuit-breaker.js';

function withClock(startMs: number) {
  let now = startMs;
  return {
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
  };
}

describe('cost-circuit-breaker', () => {
  it('opens after N consecutive failures and recovers via half-open', async () => {
    const clock = withClock(1_000_000);
    const breaker = createCostCircuitBreaker({
      policy: { maxConsecutiveFailures: 3, cooldownMs: 10_000 },
      now: clock.now,
    });

    const before = await breaker.allow('t1');
    expect(before.allowed).toBe(true);

    breaker.recordFailure('t1');
    breaker.recordFailure('t1');
    breaker.recordFailure('t1');

    const afterTrip = await breaker.allow('t1');
    expect(afterTrip.allowed).toBe(false);
    expect(afterTrip.state).toBe('open');

    clock.advance(11_000);
    const probe = await breaker.allow('t1');
    expect(probe.allowed).toBe(true);
    expect(probe.state).toBe('half_open');

    breaker.recordSuccess('t1');
    const recovered = await breaker.allow('t1');
    expect(recovered.state).toBe('closed');
  });

  it('trips on spend rate exceeding policy', async () => {
    const clock = withClock(0);
    const breaker = createCostCircuitBreaker({
      policy: { spendRatePerMinuteMicro: 1_000_000, cooldownMs: 5_000 },
      now: clock.now,
      getRecentSpend: async () => ({
        spentUsdMicro: 5_000_000,
        windowMs: 60_000,
      }),
    });
    const res = await breaker.allow('t1');
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/spend_rate_exceeded/);
  });

  it('snapshot reports consecutive failures', () => {
    const breaker = createCostCircuitBreaker({});
    breaker.recordFailure('t1');
    breaker.recordFailure('t1');
    const snap = breaker.snapshot('t1');
    expect(snap.consecutiveFailures).toBe(2);
  });
});
