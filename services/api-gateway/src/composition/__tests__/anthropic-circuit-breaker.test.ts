/**
 * Unit tests for the Anthropic circuit-breaker wrapper.
 *
 * Exercises the closed → open → half-open → closed/open lifecycle
 * with a stubbed AnthropicMessagesClient. The clock is injected so the
 * recovery-timeout transition is deterministic.
 */

import { describe, it, expect } from 'vitest';
import {
  createCircuitBreaker,
  wrapAnthropicWithCircuitBreaker,
  AnthropicCircuitOpenError,
  type StateTransition,
} from '../anthropic-circuit-breaker';

interface FakeClient {
  messages: {
    create: (args: unknown) => Promise<unknown>;
  };
}

function buildFlakyClient(opts: {
  failures?: number;
  thenSuccess?: boolean;
  alwaysFail?: boolean;
}): FakeClient & { calls: number } {
  let calls = 0;
  const failures = opts.failures ?? 0;
  const thenSuccess = opts.thenSuccess ?? true;
  const alwaysFail = opts.alwaysFail ?? false;
  const client: FakeClient & { calls: number } = {
    calls: 0,
    messages: {
      async create() {
        calls += 1;
        client.calls = calls;
        if (alwaysFail || calls <= failures) {
          throw new Error(`upstream failure #${calls}`);
        }
        if (!thenSuccess) throw new Error('still failing');
        return { id: `resp_${calls}`, content: [] };
      },
    },
  };
  return client;
}

describe('createCircuitBreaker', () => {
  it('starts CLOSED and stays CLOSED on success', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3 });
    await breaker.exec(async () => 'ok');
    await breaker.exec(async () => 'ok');
    expect(breaker.state).toBe('closed');
  });

  it('trips OPEN after the configured number of consecutive errors', async () => {
    const transitions: StateTransition[] = [];
    const breaker = createCircuitBreaker({
      failureThreshold: 3,
      onStateChange: (t) => transitions.push(t),
    });
    for (let i = 0; i < 3; i += 1) {
      try {
        await breaker.exec(async () => {
          throw new Error('boom');
        });
      } catch {
        /* ignore */
      }
    }
    expect(breaker.state).toBe('open');
    expect(transitions.find((t) => t.to === 'open')).toBeDefined();
    // subsequent calls reject without invoking the inner fn
    await expect(
      breaker.exec(async () => 'never-reached'),
    ).rejects.toBeInstanceOf(AnthropicCircuitOpenError);
  });

  it('moves to HALF-OPEN after the recovery timeout', async () => {
    let now = 1_000;
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 30_000,
      now: () => now,
    });
    for (let i = 0; i < 2; i += 1) {
      try {
        await breaker.exec(async () => {
          throw new Error('upstream');
        });
      } catch {
        /* ignore */
      }
    }
    expect(breaker.state).toBe('open');
    // Advance past the recovery window
    now += 30_001;
    // First call after the timeout should attempt the inner fn (half-open trial)
    const ok = await breaker.exec(async () => 'recovered');
    expect(ok).toBe('recovered');
    expect(breaker.state).toBe('closed');
  });

  it('half-open success returns to CLOSED with reset failure count', async () => {
    let now = 0;
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      now: () => now,
    });
    try {
      await breaker.exec(async () => {
        throw new Error('e1');
      });
    } catch {
      /* ignore */
    }
    try {
      await breaker.exec(async () => {
        throw new Error('e2');
      });
    } catch {
      /* ignore */
    }
    expect(breaker.state).toBe('open');
    now += 200;
    await breaker.exec(async () => 'ok');
    expect(breaker.state).toBe('closed');
    expect(breaker.consecutiveFailures).toBe(0);
  });

  it('half-open failure trips the breaker back to OPEN', async () => {
    let now = 0;
    const transitions: StateTransition[] = [];
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      recoveryTimeoutMs: 100,
      now: () => now,
      onStateChange: (t) => transitions.push(t),
    });
    for (let i = 0; i < 2; i += 1) {
      try {
        await breaker.exec(async () => {
          throw new Error('upstream');
        });
      } catch {
        /* ignore */
      }
    }
    expect(breaker.state).toBe('open');
    now += 200;
    try {
      await breaker.exec(async () => {
        throw new Error('half-open-fail');
      });
    } catch {
      /* ignore */
    }
    expect(breaker.state).toBe('open');
    // Should have produced a half-open → open transition
    expect(
      transitions.some((t) => t.from === 'half-open' && t.to === 'open'),
    ).toBe(true);
  });

  it('emits a state-transition event on open', async () => {
    const transitions: StateTransition[] = [];
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      onStateChange: (t) => transitions.push(t),
    });
    try {
      await breaker.exec(async () => {
        throw new Error('boom');
      });
    } catch {
      /* ignore */
    }
    expect(transitions.length).toBeGreaterThan(0);
    const t = transitions[0]!;
    expect(t.from).toBe('closed');
    expect(t.to).toBe('open');
    expect(t.reason).toContain('failure_threshold_reached');
  });
});

describe('wrapAnthropicWithCircuitBreaker', () => {
  it('proxies successful calls to the underlying client', async () => {
    const client = buildFlakyClient({ failures: 0 });
    const wrapped = wrapAnthropicWithCircuitBreaker(client, { failureThreshold: 5 });
    const out = await wrapped.messages.create({ model: 'claude' });
    expect(out).toMatchObject({ id: 'resp_1' });
    expect(wrapped.__circuit.state).toBe('closed');
  });

  it('rejects subsequent calls with AnthropicCircuitOpenError once the breaker is OPEN', async () => {
    const client = buildFlakyClient({ alwaysFail: true });
    const wrapped = wrapAnthropicWithCircuitBreaker(client, { failureThreshold: 2 });
    for (let i = 0; i < 2; i += 1) {
      await expect(
        wrapped.messages.create({ model: 'claude' }),
      ).rejects.toThrow(/upstream failure/);
    }
    expect(wrapped.__circuit.state).toBe('open');
    await expect(
      wrapped.messages.create({ model: 'claude' }),
    ).rejects.toBeInstanceOf(AnthropicCircuitOpenError);
  });
});
